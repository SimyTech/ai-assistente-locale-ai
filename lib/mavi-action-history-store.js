import { tenantActionHistoryKey } from "./tenant.js";

const redisUrl = env => env.UPSTASH_REDIS_REST_URL || "";
const redisToken = env => env.UPSTASH_REDIS_REST_TOKEN || "";

async function redisCommand(env, fetchImpl, command, ...args) {
  if (!redisUrl(env) || !redisToken(env)) throw new Error("Upstash Redis non configurato.");
  if (typeof fetchImpl !== "function") throw new Error("Trasporto Redis non disponibile.");
  const response = await fetchImpl(redisUrl(env), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${redisToken(env)}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify([command, ...args])
  });
  if (!response.ok) throw new Error(`Redis HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(String(payload.error));
  return payload.result;
}

function keyForTenant(tenantId) {
  const key = tenantActionHistoryKey(tenantId);
  if (!key) throw new Error("Tenant non valido per lo storico azioni.");
  return key;
}

export async function saveActionHistorySnapshot(tenantId, snapshot, env = process.env, fetchImpl = globalThis.fetch) {
  const key = keyForTenant(tenantId);
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("Snapshot azioni non valido.");
  }
  await redisCommand(env, fetchImpl, "SET", key, JSON.stringify(snapshot));
  return { saved: true, key };
}

export async function loadActionHistorySnapshot(tenantId, env = process.env, fetchImpl = globalThis.fetch) {
  const key = keyForTenant(tenantId);
  const raw = await redisCommand(env, fetchImpl, "GET", key);
  if (!raw) return { found: false, key, snapshot: null };
  try {
    const snapshot = JSON.parse(raw);
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      return { found: true, key, snapshot: null, invalid: true };
    }
    return { found: true, key, snapshot, invalid: false };
  } catch {
    return { found: true, key, snapshot: null, invalid: true };
  }
}

export async function persistActionLifecycle(tenantId, lifecycle, env = process.env, fetchImpl = globalThis.fetch) {
  if (!lifecycle || typeof lifecycle.snapshot !== "function") {
    throw new Error("Lifecycle azioni non persistibile.");
  }
  return saveActionHistorySnapshot(tenantId, lifecycle.snapshot(), env, fetchImpl);
}

export async function hydrateActionLifecycle(tenantId, lifecycle, env = process.env, fetchImpl = globalThis.fetch) {
  if (!lifecycle || typeof lifecycle.restore !== "function") {
    throw new Error("Lifecycle azioni non ripristinabile.");
  }
  const stored = await loadActionHistorySnapshot(tenantId, env, fetchImpl);
  if (!stored.found) return { restored: false, found: false, invalid: false, accepted: 0, rejected: 0 };
  if (stored.invalid || !stored.snapshot) return { restored: false, found: true, invalid: true, accepted: 0, rejected: 0 };
  const result = lifecycle.restore(stored.snapshot);
  return {
    restored: Boolean(result?.accepted || result?.restored || result?.acceptedCount),
    found: true,
    invalid: false,
    ...result
  };
}

export async function deleteActionHistory(tenantId, env = process.env, fetchImpl = globalThis.fetch) {
  const key = keyForTenant(tenantId);
  await redisCommand(env, fetchImpl, "DEL", key);
  return { deleted: true, key };
}
