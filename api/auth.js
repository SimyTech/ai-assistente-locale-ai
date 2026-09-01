import { authenticateOwnerAccount } from "../lib/accounts.js";
import { authenticateStoredOwnerAccount } from "../lib/account-store.js";
import { ownerAuthorized, ownerTokenForTenant } from "../lib/auth.js";
import { clientAddress, rateLimitKey, rateLimitPolicy } from "../lib/rate-limit.js";
import { clearSessionCookie, createSession, sessionCookie, sessionSecretForTenant } from "../lib/session.js";
import { explicitTenantId, isValidTenantId, normalizeTenantId, resolveTenantId } from "../lib/tenant.js";

const redisUrl = () => process.env.UPSTASH_REDIS_REST_URL || "";
const redisToken = () => process.env.UPSTASH_REDIS_REST_TOKEN || "";

async function redisCommand(command, ...args) {
  if (!redisUrl() || !redisToken()) return null;
  const response = await fetch(redisUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${redisToken()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify([command, ...args])
  });
  if (!response.ok) throw new Error(`Redis HTTP ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(String(data.error));
  return data.result;
}

function loginIdentity(req, login = "") {
  return `${clientAddress(req)}|${String(login || "legacy").trim().toLowerCase()}`;
}

async function failedLoginLimited(req, res, tenantId, login = "") {
  const policy = rateLimitPolicy("auth");
  if (!policy || !redisUrl() || !redisToken()) return false;

  const key = rateLimitKey({
    tenantId,
    action: "auth",
    identity: loginIdentity(req, login)
  });

  try {
    const count = Number(await redisCommand("INCR", key));
    if (count === 1) {
      await redisCommand("EXPIRE", key, String(policy.windowSeconds));
    }

    res.setHeader("X-RateLimit-Limit", String(policy.limit));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, policy.limit - count)));

    if (count <= policy.limit) return false;

    res.setHeader("Retry-After", String(policy.windowSeconds));
    res.status(429).json({
      ok: false,
      authenticated: false,
      error: "Troppi tentativi di accesso. Riprova più tardi."
    });
    return true;
  } catch (error) {
    console.error("MAVIRI AUTH RATE LIMIT ERROR:", error);
    return false;
  }
}

async function clearFailedLogins(req, tenantId, login = "") {
  if (!redisUrl() || !redisToken()) return;
  const key = rateLimitKey({
    tenantId,
    action: "auth",
    identity: loginIdentity(req, login)
  });
  try {
    await redisCommand("DEL", key);
  } catch (error) {
    console.error("MAVIRI AUTH RATE LIMIT RESET ERROR:", error);
  }
}

async function authenticateAccount(login, password) {
  const configured = authenticateOwnerAccount({ login, password });
  if (configured) return configured;
  if (!redisUrl() || !redisToken()) return null;
  try {
    return await authenticateStoredOwnerAccount({ login, password });
  } catch (error) {
    console.error("MAVIRI STORED ACCOUNT AUTH ERROR:", error);
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const requestedTenant = explicitTenantId(req, body);
  if (requestedTenant && !isValidTenantId(requestedTenant)) {
    return res.status(400).json({ ok: false, error: "Identificativo attività non valido." });
  }
  const resolvedTenant = resolveTenantId(req, body);

  if (req.method === "GET") {
    const authenticated = ownerAuthorized(req, resolvedTenant);
    return res.status(authenticated ? 200 : 401).json({
      ok: authenticated,
      authenticated,
      tenantId: resolvedTenant
    });
  }

  if (req.method === "DELETE") {
    res.setHeader("Set-Cookie", clearSessionCookie());
    return res.status(200).json({ ok: true, authenticated: false });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ ok: false, error: "Metodo non consentito." });
  }

  const login = String(body.username || body.email || body.login || "").trim();
  const password = String(body.password || "");
  const usingAccountCredentials = Boolean(login || password);

  let tenantId = resolvedTenant;
  let account = null;

  if (usingAccountCredentials) {
    account = await authenticateAccount(login, password);

    if (!account) {
      if (await failedLoginLimited(req, res, tenantId, login)) return;
      return res.status(401).json({ ok: false, authenticated: false, error: "Credenziali non valide." });
    }

    tenantId = account.tenantId;

    if (requestedTenant && normalizeTenantId(requestedTenant, "") !== tenantId) {
      if (await failedLoginLimited(req, res, tenantId, login)) return;
      return res.status(403).json({
        ok: false,
        authenticated: false,
        error: "L'account non appartiene all'attività richiesta."
      });
    }
  } else {
    const token = String(body.token || "").trim();
    const syntheticRequest = { headers: { "x-maviri-owner-token": token } };
    if (!ownerAuthorized(syntheticRequest, tenantId)) {
      if (await failedLoginLimited(req, res, tenantId)) return;
      return res.status(401).json({ ok: false, authenticated: false, error: "Credenziali non valide." });
    }
  }

  await clearFailedLogins(req, tenantId, login);

  const tenantToken = ownerTokenForTenant(tenantId);
  const secret = sessionSecretForTenant(tenantId, process.env, tenantToken);
  if (!secret) {
    return res.status(503).json({
      ok: false,
      authenticated: false,
      error: "Sessioni Maviri non configurate."
    });
  }

  const session = createSession({ tenantId, secret });
  res.setHeader("Set-Cookie", sessionCookie(session));
  return res.status(200).json({
    ok: true,
    authenticated: true,
    tenantId,
    account: account ? {
      id: account.id,
      username: account.username,
      email: account.email,
      displayName: account.displayName,
      role: account.role
    } : null,
    legacyTokenLogin: !account
  });
}
