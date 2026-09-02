import { timingSafeEqual } from "node:crypto";
import { normalizeTenantId } from "./tenant.js";
import { cookieValue, sessionSecretForTenant, verifySession } from "./session.js";

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
  const expected = ownerTokenForTenant(tenantId, env);
  if (safeEqual(supplied, expected)) return true;
  return verifySession(cookieValue(req), {
    tenantId,
    secret: sessionSecretForTenant(tenantId, env, expected)
  });
}

export function normalizePhone(value) {
  const source = clean(value);
  const digits = source.replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-10) : "";
}

function phoneOwnershipIdentity(value) {
  const source = clean(value);
  const digits = source.replace(/\D/g, "");
  if (digits.length < 7) return "";

  const explicitInternational = source.startsWith("+") || source.startsWith("00");
  const internationalDigits = source.startsWith("00") ? digits.slice(2) : digits;

  if (explicitInternational) {
    if (internationalDigits.startsWith("39") && internationalDigits.length >= 9) {
      const national = internationalDigits.slice(2);
      return national.length >= 7 ? `it:${national}` : "";
    }
    return `intl:${internationalDigits}`;
  }

  if (digits.startsWith("39") && digits.length > 10) {
    const national = digits.slice(2);
    if (national.length >= 7) return `it:${national}`;
  }

  if (digits.length <= 10) return `it:${digits}`;
  return `raw:${digits}`;
}

export function clientOwnsAppointment(appointment, body = {}) {
  const supplied = phoneOwnershipIdentity(body.phone || body.whatsapp || body.clientPhone || body.clientWhatsapp);
  const expected = phoneOwnershipIdentity(appointment?.phone || appointment?.whatsapp);
  return Boolean(supplied && expected && supplied === expected);
}
