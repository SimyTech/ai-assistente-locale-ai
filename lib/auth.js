import { timingSafeEqual } from "node:crypto";
import { normalizeTenantId } from "./tenant.js";

function clean(value) {
  return String(value ?? "").trim();
}

function safeEqual(left, right) {
  const a = Buffer.from(clean(left));
  const b = Buffer.from(clean(right));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export function ownerTokenForTenant(tenantId, env = process.env) {
  const id = normalizeTenantId(tenantId);
  const configured = clean(env.MAVIRI_OWNER_TOKENS);

  if (configured) {
    try {
      const tokens = JSON.parse(configured);
      if (tokens && typeof tokens === "object" && !Array.isArray(tokens)) {
        const token = clean(tokens[id]);
        if (token) return token;
      }
    } catch {
      return "";
    }
  }

  return id === "default" ? clean(env.MAVIRI_OWNER_SYNC_TOKEN) : "";
}

export function ownerAuthorized(req, tenantId, env = process.env) {
  const supplied = clean(req?.headers?.["x-maviri-owner-token"]);
  return safeEqual(supplied, ownerTokenForTenant(tenantId, env));
}

export function normalizePhone(value) {
  const source = clean(value);
  const digits = source.replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-10) : "";
}

export function clientOwnsAppointment(appointment, body = {}) {
  const supplied = normalizePhone(body.phone || body.whatsapp || body.clientPhone || body.clientWhatsapp);
  const expected = normalizePhone(appointment?.phone || appointment?.whatsapp);
  return Boolean(supplied && expected && supplied === expected);
}
