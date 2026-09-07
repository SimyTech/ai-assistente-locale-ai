import { createHmac, timingSafeEqual } from "node:crypto";

const clean = value => String(value ?? "").trim();
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 7;

function secret() {
  return clean(process.env.MAVIRI_SESSION_SECRET);
}

function encode(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decode(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function sign(payload) {
  const key = secret();
  if (!key) throw new Error("MAVIRI_SESSION_SECRET non configurato.");
  return createHmac("sha256", key).update(payload).digest("base64url");
}

function safeEqual(left, right) {
  const a = Buffer.from(clean(left));
  const b = Buffer.from(clean(right));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export function createMaviEntryToken({ tenantId, clientId = "", appointmentId = "", ttlMs = DEFAULT_TTL_MS } = {}) {
  const tenant = clean(tenantId);
  if (!tenant) throw new Error("tenantId obbligatorio.");

  const now = Date.now();
  const payload = encode({
    v: 1,
    tenantId: tenant,
    clientId: clean(clientId),
    appointmentId: clean(appointmentId),
    iat: now,
    exp: now + Math.max(60_000, Number(ttlMs) || DEFAULT_TTL_MS)
  });

  return `${payload}.${sign(payload)}`;
}

export function verifyMaviEntryToken(token) {
  const raw = clean(token);
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return { ok: false, error: "Token Mavi non valido." };

  const payload = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  if (!safeEqual(signature, sign(payload))) return { ok: false, error: "Firma token Mavi non valida." };

  try {
    const data = decode(payload);
    if (!data || data.v !== 1 || !clean(data.tenantId)) return { ok: false, error: "Token Mavi incompleto." };
    if (!Number.isFinite(Number(data.exp)) || Date.now() > Number(data.exp)) return { ok: false, error: "Link Mavi scaduto." };

    return {
      ok: true,
      tenantId: clean(data.tenantId),
      clientId: clean(data.clientId),
      appointmentId: clean(data.appointmentId),
      expiresAt: Number(data.exp)
    };
  } catch {
    return { ok: false, error: "Token Mavi non leggibile." };
  }
}

export function buildMaviEntryUrl({ origin, tenantId, clientId = "", appointmentId = "", ttlMs } = {}) {
  const base = clean(origin).replace(/\/$/, "");
  if (!base) throw new Error("Origin Maviri obbligatoria.");
  const token = createMaviEntryToken({ tenantId, clientId, appointmentId, ttlMs });
  return `${base}/mavi?token=${encodeURIComponent(token)}`;
}
