import { createHash, randomBytes } from "node:crypto";
import { getStoredOwnerAccount, markStoredOwnerEmailVerified } from "./account-store.js";
import { normalizeTenantId } from "./tenant.js";

const clean = value => String(value ?? "").trim();
const redisUrl = env => env.UPSTASH_REDIS_REST_URL || "";
const redisToken = env => env.UPSTASH_REDIS_REST_TOKEN || "";
const VERIFY_TTL_SECONDS = 24 * 60 * 60;
const RESEND_COOLDOWN_SECONDS = 60;

function tokenDigest(token) {
  return createHash("sha256").update(clean(token)).digest("hex");
}

export function emailVerificationKey(token) {
  return `maviri:email-verification:${tokenDigest(token)}`;
}

export function emailVerificationCooldownKey(accountId) {
  return `maviri:email-verification:cooldown:${clean(accountId)}`;
}

async function redisCommand(env, command, ...args) {
  if (!redisUrl(env) || !redisToken(env)) throw new Error("Upstash Redis non configurato.");
  const response = await fetch(redisUrl(env), {
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

export function emailVerificationConfigured(env = process.env) {
  return Boolean(clean(env.RESEND_API_KEY) && clean(env.MAVIRI_EMAIL_FROM) && clean(env.MAVIRI_PUBLIC_URL));
}

export async function sendEmailVerificationEmail({ email, token }, env = process.env) {
  if (!emailVerificationConfigured(env)) return { sent: false, reason: "email-not-configured" };
  const baseUrl = clean(env.MAVIRI_PUBLIC_URL).replace(/\/$/, "");
  const verifyUrl = `${baseUrl}/verify-email?token=${encodeURIComponent(token)}`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${clean(env.RESEND_API_KEY)}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: clean(env.MAVIRI_EMAIL_FROM),
      to: [clean(email).toLowerCase()],
      subject: "Verifica la tua email Maviri",
      html: `<p>Benvenuto in Maviri.</p><p>Conferma il tuo indirizzo email per proteggere il tuo account.</p><p><a href="${verifyUrl}">Verifica email</a></p><p>Il link scade tra 24 ore. Se non hai creato tu questo account, ignora questa email.</p>`
    })
  });
  if (!response.ok) throw new Error(`Invio email HTTP ${response.status}`);
  return { sent: true, reason: "" };
}

export async function requestEmailVerification(email, env = process.env, expectedTenantId = "") {
  const normalizedEmail = clean(email).toLowerCase();
  if (!normalizedEmail) return { accepted: false, sent: false, reason: "invalid-email" };
  const account = await getStoredOwnerAccount(normalizedEmail, env);
  if (!account || account.disabled === true) return { accepted: false, sent: false, reason: "account-not-found" };

  const accountTenant = normalizeTenantId(account.tenantId, "");
  const expectedTenant = normalizeTenantId(expectedTenantId, "");
  if (expectedTenant && accountTenant !== expectedTenant) {
    return { accepted: false, sent: false, reason: "tenant-mismatch" };
  }
  if (account.emailVerified === true) return { accepted: true, sent: false, reason: "already-verified" };
  if (!emailVerificationConfigured(env)) return { accepted: false, sent: false, reason: "email-not-configured" };

  const cooldownKey = emailVerificationCooldownKey(account.id);
  const cooldown = await redisCommand(env, "SET", cooldownKey, "1", "NX", "EX", String(RESEND_COOLDOWN_SECONDS));
  if (String(cooldown).toUpperCase() !== "OK") {
    return { accepted: false, sent: false, reason: "cooldown" };
  }

  const token = randomBytes(32).toString("hex");
  const payload = JSON.stringify({
    email: normalizedEmail,
    tenantId: accountTenant,
    accountId: clean(account.id),
    createdAt: new Date().toISOString()
  });
  await redisCommand(env, "SET", emailVerificationKey(token), payload, "EX", String(VERIFY_TTL_SECONDS));

  try {
    const delivery = await sendEmailVerificationEmail({ email: normalizedEmail, token }, env);
    if (!delivery.sent) {
      await redisCommand(env, "DEL", emailVerificationKey(token));
      await redisCommand(env, "DEL", cooldownKey).catch(() => {});
      return { accepted: false, sent: false, reason: delivery.reason };
    }
  } catch (error) {
    await redisCommand(env, "DEL", emailVerificationKey(token)).catch(() => {});
    await redisCommand(env, "DEL", cooldownKey).catch(() => {});
    throw error;
  }

  return { accepted: true, sent: true, reason: "" };
}

export async function consumeEmailVerification(token, env = process.env) {
  const rawToken = clean(token);
  if (!rawToken) return { verified: false, reason: "invalid-request" };
  const raw = await redisCommand(env, "GETDEL", emailVerificationKey(rawToken));
  if (!raw) return { verified: false, reason: "invalid-or-expired" };

  let payload;
  try { payload = JSON.parse(raw); } catch { return { verified: false, reason: "invalid-or-expired" }; }
  const email = clean(payload?.email).toLowerCase();
  const tenantId = clean(payload?.tenantId);
  const accountId = clean(payload?.accountId);
  if (!email || !tenantId || !accountId) return { verified: false, reason: "invalid-or-expired" };

  return markStoredOwnerEmailVerified({ login: email, tenantId, accountId }, env);
}
