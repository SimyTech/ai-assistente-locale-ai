import { ownerAuthorized } from "./auth.js";
import { resolveTenantId } from "./tenant.js";
import { deliverAuthorizedProposal } from "./outbound-delivery.js";
import { createActionLifecycle, proposalActionId } from "./mavi-action-lifecycle.js";
import { hydrateActionLifecycle, persistActionLifecycle } from "./mavi-action-history-store.js";

const clean = value => String(value ?? "").replace(/\u0000/g, "").trim();
const redisUrl = env => env.UPSTASH_REDIS_REST_URL || "";
const redisToken = env => env.UPSTASH_REDIS_REST_TOKEN || "";
const RESULT_TTL_SECONDS = 7 * 24 * 60 * 60;
const LOCK_TTL_MS = 15000;

function json(res, status, payload) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(status).json(payload);
}

function safeActionId(value) {
  const id = clean(value).toLowerCase();
  return /^mavi-action-[a-f0-9]{8}$/.test(id) ? id : "";
}

function resultKey(tenantId, actionId) {
  return `maviri:tenant:${clean(tenantId) || "default"}:authorized-send:${actionId}`;
}

function lockKey(tenantId, actionId) {
  return `${resultKey(tenantId, actionId)}:lock`;
}

async function redisCommand(env, fetchImpl, command, ...args) {
  if (!redisUrl(env) || !redisToken(env)) throw new Error("Upstash Redis non configurato.");
  const response = await fetchImpl(redisUrl(env), {
    method: "POST",
    headers: { Authorization: `Bearer ${redisToken(env)}`, "Content-Type": "application/json" },
    body: JSON.stringify([command, ...args])
  });
  if (!response.ok) throw new Error(`Redis HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(String(payload.error));
  return payload.result;
}

async function readResult(env, fetchImpl, key) {
  const raw = await redisCommand(env, fetchImpl, "GET", key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function storeResult(env, fetchImpl, key, value) {
  return redisCommand(env, fetchImpl, "SET", key, JSON.stringify(value), "EX", String(RESULT_TTL_SECONDS));
}

async function acquireLock(env, fetchImpl, key) {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const result = await redisCommand(env, fetchImpl, "SET", key, token, "NX", "PX", String(LOCK_TTL_MS));
  return { acquired: String(result).toUpperCase() === "OK", token };
}

async function releaseLock(env, fetchImpl, key, token) {
  try {
    await redisCommand(env, fetchImpl, "EVAL", "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", "1", key, token);
  } catch {}
}

export function validateAuthorizedSendBody(body = {}) {
  const actionId = safeActionId(body.actionId);
  const proposal = body && typeof body.proposal === "object" && !Array.isArray(body.proposal) ? body.proposal : null;
  if (!actionId) return { ok: false, error: "action-id-invalid" };
  if (!proposal) return { ok: false, error: "proposal-invalid" };
  if (proposalActionId(proposal) !== actionId) return { ok: false, error: "action-id-mismatch" };
  if (proposal.approved !== true) return { ok: false, error: "approval-required" };
  if (!clean(proposal.channel) || !clean(proposal.recipient) || !clean(proposal.text)) return { ok: false, error: "proposal-incomplete" };
  return { ok: true, actionId, proposal };
}

async function ensureCompletedLifecycle({ tenantId, proposal, env, fetchImpl }) {
  const lifecycle = createActionLifecycle();
  await hydrateActionLifecycle(tenantId, lifecycle, env, fetchImpl);
  const current = lifecycle.get(proposal);
  if (current?.status !== "completed") {
    lifecycle.approve(proposal);
    const requested = lifecycle.requestSend(proposal);
    if (requested.accepted || lifecycle.get(proposal)?.status === "send-requested") lifecycle.complete(proposal);
    await persistActionLifecycle(tenantId, lifecycle, env, fetchImpl);
  }
  return lifecycle;
}

export default async function authorizedSendHandler(req, res, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (req?.method !== "POST") return json(res, 405, { ok: false, error: "Metodo non consentito." });

  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const tenantId = resolveTenantId(req, body);
  if (!ownerAuthorized(req, tenantId, env)) return json(res, 401, { ok: false, error: "Autenticazione proprietario richiesta." });

  const valid = validateAuthorizedSendBody(body);
  if (!valid.ok) return json(res, 400, { ok: false, error: valid.error });
  if (!redisUrl(env) || !redisToken(env)) return json(res, 503, { ok: false, error: "Upstash Redis non configurato." });
  if (typeof fetchImpl !== "function") return json(res, 503, { ok: false, error: "Trasporto non disponibile." });

  const key = resultKey(tenantId, valid.actionId);
  const previous = await readResult(env, fetchImpl, key);
  if (previous?.sent) {
    await ensureCompletedLifecycle({ tenantId, proposal: valid.proposal, env, fetchImpl });
    return json(res, 200, { ok: true, duplicate: true, actionId: valid.actionId, delivery: previous });
  }

  const lock = await acquireLock(env, fetchImpl, lockKey(tenantId, valid.actionId));
  if (!lock.acquired) {
    const concurrent = await readResult(env, fetchImpl, key);
    if (concurrent?.sent) {
      await ensureCompletedLifecycle({ tenantId, proposal: valid.proposal, env, fetchImpl });
      return json(res, 200, { ok: true, duplicate: true, actionId: valid.actionId, delivery: concurrent });
    }
    return json(res, 409, { ok: false, error: "Invio già in elaborazione.", actionId: valid.actionId });
  }

  const lifecycle = createActionLifecycle();
  try {
    await hydrateActionLifecycle(tenantId, lifecycle, env, fetchImpl);
    const recheck = await readResult(env, fetchImpl, key);
    if (recheck?.sent) {
      await ensureCompletedLifecycle({ tenantId, proposal: valid.proposal, env, fetchImpl });
      return json(res, 200, { ok: true, duplicate: true, actionId: valid.actionId, delivery: recheck });
    }

    lifecycle.approve(valid.proposal);
    const sendState = lifecycle.requestSend(valid.proposal);
    if (!sendState.accepted && lifecycle.get(valid.proposal)?.status !== "send-requested") {
      return json(res, 409, { ok: false, error: "Stato azione non inviabile.", actionId: valid.actionId });
    }
    await persistActionLifecycle(tenantId, lifecycle, env, fetchImpl);

    const delivery = await deliverAuthorizedProposal(valid.proposal, tenantId, env, fetchImpl);
    if (!delivery.sent) {
      lifecycle.fail(valid.proposal, delivery.reason || "delivery-failed");
      await persistActionLifecycle(tenantId, lifecycle, env, fetchImpl);
      return json(res, 409, { ok: false, error: delivery.reason || "delivery-failed", actionId: valid.actionId });
    }

    const stored = { sent: true, channel: delivery.channel || clean(valid.proposal.channel), id: delivery.id || null, sentAt: new Date().toISOString() };
    await storeResult(env, fetchImpl, key, stored);
    lifecycle.complete(valid.proposal);
    await persistActionLifecycle(tenantId, lifecycle, env, fetchImpl);
    return json(res, 200, { ok: true, duplicate: false, actionId: valid.actionId, delivery: stored });
  } catch (error) {
    if (lifecycle.get(valid.proposal)?.status === "send-requested") {
      lifecycle.fail(valid.proposal, clean(error?.message) || "Errore di consegna.");
      await persistActionLifecycle(tenantId, lifecycle, env, fetchImpl).catch(() => {});
    }
    return json(res, 502, { ok: false, error: clean(error?.message) || "Errore di consegna.", actionId: valid.actionId });
  } finally {
    await releaseLock(env, fetchImpl, lockKey(tenantId, valid.actionId), lock.token);
  }
}
