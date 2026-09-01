import { randomBytes } from "node:crypto";
import { createStoredOwnerAccount } from "../lib/account-store.js";
import { clientAddress, rateLimitKey, rateLimitPolicy } from "../lib/rate-limit.js";
import { createSession, sessionCookie, sessionSecretForTenant } from "../lib/session.js";
import { normalizeTenantId } from "../lib/tenant.js";

const clean = value => String(value ?? "").trim();
const redisUrl = () => process.env.UPSTASH_REDIS_REST_URL || "";
const redisToken = () => process.env.UPSTASH_REDIS_REST_TOKEN || "";

async function redisCommand(command, ...args) {
  if (!redisUrl() || !redisToken()) throw new Error("Upstash Redis non configurato.");
  const response = await fetch(redisUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${redisToken()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify([command, ...args])
  });
  if (!response.ok) throw new Error(`Redis HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(String(payload.error));
  return payload.result;
}

function slug(value) {
  return clean(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42) || "attivita";
}

function tenantForBusiness(name) {
  return normalizeTenantId(`${slug(name)}-${randomBytes(3).toString("hex")}`);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value).toLowerCase());
}

async function enforceRegistrationLimit(req, res) {
  const policy = rateLimitPolicy("register");
  if (!policy) return false;
  const key = rateLimitKey({
    tenantId: "registration",
    action: "register",
    identity: clientAddress(req)
  });
  const count = Number(await redisCommand("INCR", key));
  if (count === 1) await redisCommand("EXPIRE", key, String(policy.windowSeconds));
  res.setHeader("X-RateLimit-Limit", String(policy.limit));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, policy.limit - count)));
  if (count <= policy.limit) return false;
  res.setHeader("Retry-After", String(policy.windowSeconds));
  res.status(429).json({ ok: false, error: "Troppe registrazioni da questo dispositivo. Riprova più tardi." });
  return true;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Metodo non consentito." });
  }

  if (!redisUrl() || !redisToken()) {
    return res.status(503).json({ ok: false, error: "Registrazione Maviri non ancora configurata." });
  }

  if (!sessionSecretForTenant("default")) {
    return res.status(503).json({ ok: false, error: "Sessioni Maviri non configurate." });
  }

  try {
    if (await enforceRegistrationLimit(req, res)) return;

    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    const businessName = clean(body.businessName || body.activityName || body.name);
    const ownerName = clean(body.ownerName || body.displayName);
    const email = clean(body.email).toLowerCase();
    const password = String(body.password || "");

    if (businessName.length < 2 || businessName.length > 80) {
      return res.status(400).json({ ok: false, error: "Inserisci un nome attività valido." });
    }
    if (!validEmail(email)) {
      return res.status(400).json({ ok: false, error: "Inserisci un indirizzo email valido." });
    }
    if (password.length < 10 || password.length > 200) {
      return res.status(400).json({ ok: false, error: "La password deve contenere almeno 10 caratteri." });
    }

    const tenantId = tenantForBusiness(businessName);
    const result = await createStoredOwnerAccount({
      email,
      password,
      tenantId,
      displayName: ownerName || businessName
    });

    if (!result.created) {
      return res.status(409).json({ ok: false, error: "Esiste già un account con questa email." });
    }

    const secret = sessionSecretForTenant(tenantId);
    const session = createSession({ tenantId, secret });
    res.setHeader("Set-Cookie", sessionCookie(session));

    return res.status(201).json({
      ok: true,
      authenticated: true,
      tenantId,
      needsSetup: true,
      account: result.account,
      businessName
    });
  } catch (error) {
    console.error("MAVIRI REGISTER ERROR:", error);
    return res.status(500).json({ ok: false, error: "Impossibile creare l'account in questo momento." });
  }
}
