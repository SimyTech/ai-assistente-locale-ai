import { createHash, randomBytes } from "node:crypto";
import { getStoredOwnerAccount, resetStoredOwnerPassword } from "./account-store.js";
import { publicHttpsUrl, validPublicHttpsUrl } from "./public-url.js";

const clean = value => String(value ?? "").trim();
const redisUrl = env => env.UPSTASH_REDIS_REST_URL || "";
const redisToken = env => env.UPSTASH_REDIS_REST_TOKEN || "";
const RESET_TTL_SECONDS = 30 * 60;

function tokenDigest(token) {
  return createHash("sha256").update(clean(token)).digest("hex");
}

export function passwordResetKey(token) {
  return `maviri:password-reset:${tokenDigest(token)}`;
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

export function recoveryEmailConfigured(env = process.env) {
  return Boolean(
    clean(env.RESEND_API_KEY) &&
    clean(env.MAVIRI_EMAIL_FROM) &&
    validPublicHttpsUrl(env.MAVIRI_PUBLIC_URL)
  );
}

export async function sendPasswordResetEmail({ email, token }, env = process.env) {
  if (!recoveryEmailConfigured(env)) return { sent: false, reason: "email-not-configured" };
  const baseUrl = publicHttpsUrl(env.MAVIRI_PUBLIC_URL);
  const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${clean(env.RESEND_API_KEY)}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: clean(env.MAVIRI_EMAIL_FROM),
      to: [clean(email).toLowerCase()],
      subject: "Reimposta la password Maviri",
      html: `<p>Hai richiesto di reimpostare la password del tuo account Maviri.</p><p><a href="${resetUrl}">Reimposta password</a></p><p>Il link scade tra 30 minuti. Se non hai richiesto tu questa modifica, ignora questa email.</p>`
    })
  });
  if (!response.ok) throw new Error(`Invio email HTTP ${response.status}`);
  return { sent: true, reason: "" };
}

export async function requestPasswordReset(email, env = process.env) {
  const normalizedEmail = clean(email).toLowerCase();
  if (!normalizedEmail) return { accepted: true, sent: false };
  const account = await getStoredOwnerAccount(normalizedEmail, env);
  if (!account || account.disabled === true) return { accepted: true, sent: false };
  if (!recoveryEmailConfigured(env)) return { accepted: false, sent: false, reason: "email-not-configured" };

  const token = randomBytes(32).toString("hex");
  const payload = JSON.stringify({
    email: normalizedEmail,
    tenantId: clean(account.tenantId),
    createdAt: new Date().toISOString()
  });
  await redisCommand(env, "SET", passwordResetKey(token), payload, "EX", String(RESET_TTL_SECONDS));

  try {
    const delivery = await sendPasswordResetEmail({ email: normalizedEmail, token }, env);
    if (!delivery.sent) {
      await redisCommand(env, "DEL", passwordResetKey(token));
      return { accepted: false, sent: false, reason: delivery.reason };
    }
  } catch (error) {
    await redisCommand(env, "DEL", passwordResetKey(token)).catch(() => {});
    throw error;
  }

  return { accepted: true, sent: true };
}

export async function consumePasswordReset({ token, newPassword }, env = process.env) {
  const rawToken = clean(token);
  const nextPassword = String(newPassword ?? "");
  if (!rawToken || nextPassword.length < 10 || nextPassword.length > 200) {
    return { changed: false, reason: "invalid-request" };
  }

  const raw = await redisCommand(env, "GETDEL", passwordResetKey(rawToken));
  if (!raw) return { changed: false, reason: "invalid-or-expired" };

  let payload;
  try { payload = JSON.parse(raw); } catch { return { changed: false, reason: "invalid-or-expired" }; }
  const email = clean(payload?.email).toLowerCase();
  const tenantId = clean(payload?.tenantId);
  if (!email || !tenantId) return { changed: false, reason: "invalid-or-expired" };

  return resetStoredOwnerPassword({ login: email, newPassword: nextPassword, tenantId }, env);
}
