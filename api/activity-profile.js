import { ownerAuthorized } from "../lib/auth.js";
import { activityProfileKey, normalizeActivityProfile } from "../lib/activity-profile.js";
import { explicitTenantId, isValidTenantId, resolveTenantId } from "../lib/tenant.js";

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

async function getProfile(tenantId) {
  const raw = await redisCommand("GET", activityProfileKey(tenantId));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function setProfile(tenantId, profile) {
  await redisCommand("SET", activityProfileKey(tenantId), JSON.stringify(profile));
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const requestedTenant = explicitTenantId(req, body);
  if (requestedTenant && !isValidTenantId(requestedTenant)) {
    return res.status(400).json({ ok: false, error: "Identificativo attività non valido." });
  }

  const tenantId = resolveTenantId(req, body);
  if (!ownerAuthorized(req, tenantId)) {
    return res.status(401).json({ ok: false, error: "Accesso titolare richiesto." });
  }

  try {
    if (req.method === "GET") {
      const stored = await getProfile(tenantId);
      return res.status(200).json({
        ok: true,
        tenantId,
        configured: Boolean(stored),
        profile: stored || normalizeActivityProfile({ sector: "generic" })
      });
    }

    if (req.method === "PUT" || req.method === "POST") {
      const profile = normalizeActivityProfile(body.profile || body);
      if (!profile.name) {
        return res.status(400).json({ ok: false, error: "Nome attività obbligatorio." });
      }
      await setProfile(tenantId, profile);
      return res.status(200).json({ ok: true, tenantId, configured: true, profile });
    }

    res.setHeader("Allow", "GET, PUT, POST");
    return res.status(405).json({ ok: false, error: "Metodo non consentito." });
  } catch (error) {
    console.error("MAVIRI ACTIVITY PROFILE ERROR:", error);
    return res.status(500).json({ ok: false, error: "Impossibile salvare il profilo attività." });
  }
}
