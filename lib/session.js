import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeTenantId } from "./tenant.js";

export const SESSION_COOKIE = "maviri_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12;

const encode = value => Buffer.from(value).toString("base64url");
const decode = value => Buffer.from(value, "base64url").toString("utf8");

function signature(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function equal(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export function sessionSecretForTenant(tenantId, env = process.env, tenantToken = "") {
  return String(env.MAVIRI_SESSION_SECRET || tenantToken || "").trim();
}

export function createSession({ tenantId, secret, now = Date.now() }) {
  if (!secret) throw new Error("Segreto sessione non configurato.");
  const payload = encode(JSON.stringify({
    tenantId: normalizeTenantId(tenantId),
    exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS
  }));
  return `${payload}.${signature(payload, secret)}`;
}

export function verifySession(token, { tenantId, secret, now = Date.now() }) {
  if (!token || !secret) return false;
  const [payload, suppliedSignature, extra] = String(token).split(".");
  if (!payload || !suppliedSignature || extra) return false;
  if (!equal(suppliedSignature, signature(payload, secret))) return false;

  try {
    const data = JSON.parse(decode(payload));
    return data.tenantId === normalizeTenantId(tenantId) && Number(data.exp) > Math.floor(now / 1000);
  } catch {
    return false;
  }
}

export function cookieValue(req, name = SESSION_COOKIE) {
  const source = String(req?.headers?.cookie || "");
  for (const part of source.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return "";
}

export function sessionCookie(token) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}
