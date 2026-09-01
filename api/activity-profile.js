import { ownerAuthorized } from "../lib/auth.js";
import { activityProfileKey, normalizeActivityProfile } from "../lib/activity-profile.js";
import {
  explicitTenantId,
  isValidTenantId,
  resolveTenantId,
  tenantDataKey,
  tenantPublicKey
} from "../lib/tenant.js";

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

function parseJson(raw) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

async function getProfile(tenantId) {
  return parseJson(await redisCommand("GET", activityProfileKey(tenantId)));
}

async function setProfile(tenantId, profile) {
  await redisCommand("SET", activityProfileKey(tenantId), JSON.stringify(profile));
}

function profileBusiness(profile, current = {}) {
  return {
    ...current,
    name: profile.name,
    sector: profile.sector,
    description: profile.description,
    address: profile.address,
    phone: profile.phone,
    whatsapp: profile.whatsapp,
    email: profile.email,
    website: profile.website
  };
}

function profileSettings(profile, current = {}) {
  return {
    ...current,
    name: profile.name,
    sector: profile.sector,
    description: profile.description,
    address: profile.address,
    phone: profile.phone,
    whatsapp: profile.whatsapp,
    email: profile.email,
    website: profile.website
  };
}

function publicContextFromData(data) {
  const business = data.business || {};
  const settings = data.settings || {};
  return {
    ok: true,
    mode: "client",
    local: true,
    engine: "maviri-business-engine-v5",
    business: {
      name: business.name || settings.name || "",
      type: business.type || settings.type || business.sector || settings.sector || "",
      description: business.description || settings.description || "",
      address: business.address || settings.address || "",
      phone: business.phone || settings.phone || "",
      whatsapp: business.whatsapp || settings.whatsapp || ""
    },
    services: Array.isArray(data.services) ? data.services : [],
    promotions: Array.isArray(data.promotions) ? data.promotions : [],
    appointments: []
  };
}

async function syncProfileToBusinessData(tenantId, profile) {
  const key = tenantDataKey(tenantId);
  const existing = parseJson(await redisCommand("GET", key)) || {};
  const data = {
    ...existing,
    version: Number(existing.version || 1),
    revision: Number(existing.revision || 0),
    updatedAt: new Date().toISOString(),
    business: profileBusiness(profile, existing.business || {}),
    settings: profileSettings(profile, existing.settings || {}),
    services: Array.isArray(existing.services) ? existing.services : [],
    promotions: Array.isArray(existing.promotions) ? existing.promotions : [],
    clients: Array.isArray(existing.clients) ? existing.clients : [],
    appointments: Array.isArray(existing.appointments) ? existing.appointments : []
  };

  await redisCommand("SET", key, JSON.stringify(data));
  await redisCommand("SET", tenantPublicKey(tenantId), JSON.stringify(publicContextFromData(data)));
  return data;
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
      await syncProfileToBusinessData(tenantId, profile);
      return res.status(200).json({ ok: true, tenantId, configured: true, profile });
    }

    res.setHeader("Allow", "GET, PUT, POST");
    return res.status(405).json({ ok: false, error: "Metodo non consentito." });
  } catch (error) {
    console.error("MAVIRI ACTIVITY PROFILE ERROR:", error);
    return res.status(500).json({ ok: false, error: "Impossibile salvare il profilo attività." });
  }
}
