import { createHash, randomBytes, randomUUID } from "node:crypto";
import { passwordHash, verifyPassword } from "./accounts.js";
import { normalizeTenantId } from "./tenant.js";

const clean = value => String(value ?? "").trim();
const normalizeLogin = value => clean(value).toLowerCase();
const redisUrl = env => env.UPSTASH_REDIS_REST_URL || "";
const redisToken = env => env.UPSTASH_REDIS_REST_TOKEN || "";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function loginDigest(login) {
  return createHash("sha256").update(normalizeLogin(login)).digest("hex");
}

export function accountLoginKey(login) {
  return `maviri:account:login:${loginDigest(login)}`;
}

export function accountIdKey(accountId) {
  return `maviri:account:id:${clean(accountId)}`;
}

export function accountTenantOwnerKey(tenantId) {
  return `maviri:account:tenant-owner:${normalizeTenantId(tenantId, "")}`;
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

function publicAccount(account) {
  if (!account || typeof account !== "object" || Array.isArray(account)) return null;
  const tenantId = normalizeTenantId(account.tenantId, "");
  if (!tenantId || !clean(account.id)) return null;
  return {
    id: clean(account.id),
    tenantId,
    username: normalizeLogin(account.username),
    email: normalizeLogin(account.email),
    displayName: clean(account.displayName),
    role: clean(account.role || "owner") || "owner",
    emailVerified: account.emailVerified === true,
    emailVerifiedAt: clean(account.emailVerifiedAt)
  };
}

async function persistAccount(account, env = process.env) {
  const email = normalizeLogin(account?.email);
  const username = normalizeLogin(account?.username);
  const tenantId = normalizeTenantId(account?.tenantId, "");
  if (!email || !clean(account?.id) || !tenantId) throw new Error("Account memorizzato non valido.");
  const serialized = JSON.stringify(account);
  await redisCommand(env, "SET", accountLoginKey(email), serialized);
  if (username && username !== email) {
    await redisCommand(env, "SET", accountLoginKey(username), serialized);
  }
  await redisCommand(env, "SET", accountIdKey(account.id), serialized);
  if (clean(account.role || "owner") === "owner") {
    await redisCommand(env, "SET", accountTenantOwnerKey(tenantId), clean(account.id));
  }
}

export async function getStoredOwnerAccount(login, env = process.env) {
  const normalized = normalizeLogin(login);
  if (!normalized) return null;
  const raw = await redisCommand(env, "GET", accountLoginKey(normalized));
  if (!raw) return null;
  try {
    const account = JSON.parse(raw);
    if (!account || typeof account !== "object" || Array.isArray(account)) return null;
    return account;
  } catch {
    return null;
  }
}

export async function getStoredOwnerAccountByTenant(tenantId, env = process.env) {
  const normalizedTenant = normalizeTenantId(tenantId, "");
  if (!normalizedTenant) return null;
  const accountId = clean(await redisCommand(env, "GET", accountTenantOwnerKey(normalizedTenant)));
  if (!accountId) return null;
  const raw = await redisCommand(env, "GET", accountIdKey(accountId));
  if (!raw) return null;
  try {
    const account = JSON.parse(raw);
    if (normalizeTenantId(account?.tenantId, "") !== normalizedTenant || account?.disabled === true) return null;
    return publicAccount(account);
  } catch {
    return null;
  }
}

export async function authenticateStoredOwnerAccount({ login, password }, env = process.env) {
  const account = await getStoredOwnerAccount(login, env);
  if (!account || account.disabled === true || !verifyPassword(password, account.passwordHash)) return null;
  return publicAccount(account);
}

export async function markStoredOwnerEmailVerified({ login, tenantId }, env = process.env) {
  const account = await getStoredOwnerAccount(login, env);
  if (!account || account.disabled === true) return { verified: false, reason: "account-not-found" };
  const normalizedTenant = normalizeTenantId(tenantId, "");
  if (!normalizedTenant || normalizeTenantId(account.tenantId, "") !== normalizedTenant) {
    return { verified: false, reason: "tenant-mismatch" };
  }
  if (account.emailVerified === true) {
    return { verified: true, alreadyVerified: true, account };
  }
  const updated = {
    ...account,
    emailVerified: true,
    emailVerifiedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await persistAccount(updated, env);
  return { verified: true, alreadyVerified: false, account: updated };
}

export async function updateStoredOwnerProfile({ login, displayName, tenantId }, env = process.env) {
  const account = await getStoredOwnerAccount(login, env);
  if (!account || account.disabled === true) return { updated: false, reason: "account-not-found", account: null };
  const normalizedTenant = normalizeTenantId(tenantId, "");
  if (!normalizedTenant || normalizeTenantId(account.tenantId, "") !== normalizedTenant) {
    return { updated: false, reason: "tenant-mismatch", account: null };
  }
  const nextDisplayName = clean(displayName);
  if (nextDisplayName.length < 2 || nextDisplayName.length > 80) {
    return { updated: false, reason: "invalid-display-name", account: null };
  }
  const updated = {
    ...account,
    displayName: nextDisplayName,
    updatedAt: new Date().toISOString()
  };
  await persistAccount(updated, env);
  return { updated: true, reason: "", account: publicAccount(updated) };
}

export async function changeStoredOwnerEmail({ login, currentPassword, newEmail, tenantId }, env = process.env) {
  const account = await getStoredOwnerAccount(login, env);
  if (!account || account.disabled === true) return { changed: false, reason: "invalid-credentials", account: null };
  const normalizedTenant = normalizeTenantId(tenantId, "");
  if (!normalizedTenant || normalizeTenantId(account.tenantId, "") !== normalizedTenant) {
    return { changed: false, reason: "tenant-mismatch", account: null };
  }
  if (!verifyPassword(currentPassword, account.passwordHash)) {
    return { changed: false, reason: "invalid-credentials", account: null };
  }

  const nextEmail = normalizeLogin(newEmail);
  const oldEmail = normalizeLogin(account.email);
  const username = normalizeLogin(account.username);
  if (!EMAIL_RE.test(nextEmail) || nextEmail.length > 254) {
    return { changed: false, reason: "invalid-email", account: null };
  }
  if (nextEmail === oldEmail) {
    return { changed: false, reason: "same-email", account: publicAccount(account) };
  }

  const existing = await getStoredOwnerAccount(nextEmail, env);
  if (existing && clean(existing.id) !== clean(account.id)) {
    return { changed: false, reason: "login-exists", account: null };
  }

  const updated = {
    ...account,
    email: nextEmail,
    emailVerified: false,
    emailVerifiedAt: "",
    updatedAt: new Date().toISOString()
  };
  const nextEmailKey = accountLoginKey(nextEmail);
  const nextSerialized = JSON.stringify(updated);
  let reservedNewKey = false;

  try {
    if (!existing) {
      const reserved = await redisCommand(env, "SET", nextEmailKey, nextSerialized, "NX");
      if (String(reserved).toUpperCase() !== "OK") {
        return { changed: false, reason: "login-exists", account: null };
      }
      reservedNewKey = true;
    }
    await persistAccount(updated, env);
    if (oldEmail && oldEmail !== nextEmail && oldEmail !== username) {
      await redisCommand(env, "DEL", accountLoginKey(oldEmail));
    }
    return { changed: true, reason: "", account: publicAccount(updated) };
  } catch (error) {
    if (reservedNewKey) await redisCommand(env, "DEL", nextEmailKey).catch(() => {});
    throw error;
  }
}

export async function changeStoredOwnerPassword({ login, currentPassword, newPassword, tenantId }, env = process.env) {
  const account = await getStoredOwnerAccount(login, env);
  if (!account || account.disabled === true) return { changed: false, reason: "invalid-credentials" };
  const normalizedTenant = normalizeTenantId(tenantId, "");
  if (!normalizedTenant || normalizeTenantId(account.tenantId, "") !== normalizedTenant) {
    return { changed: false, reason: "tenant-mismatch" };
  }
  if (!verifyPassword(currentPassword, account.passwordHash)) {
    return { changed: false, reason: "invalid-credentials" };
  }

  const next = String(newPassword ?? "");
  if (next.length < 10 || next.length > 200) {
    return { changed: false, reason: "invalid-password" };
  }
  if (next === String(currentPassword ?? "")) {
    return { changed: false, reason: "same-password" };
  }

  const updated = {
    ...account,
    passwordHash: passwordHash(next, { salt: randomBytes(16).toString("hex") }),
    updatedAt: new Date().toISOString()
  };
  await persistAccount(updated, env);

  return { changed: true, reason: "" };
}

export async function resetStoredOwnerPassword({ login, newPassword, tenantId }, env = process.env) {
  const account = await getStoredOwnerAccount(login, env);
  if (!account || account.disabled === true) return { changed: false, reason: "account-not-found" };
  const normalizedTenant = normalizeTenantId(tenantId, "");
  if (!normalizedTenant || normalizeTenantId(account.tenantId, "") !== normalizedTenant) {
    return { changed: false, reason: "tenant-mismatch" };
  }
  const next = String(newPassword ?? "");
  if (next.length < 10 || next.length > 200) return { changed: false, reason: "invalid-password" };
  if (verifyPassword(next, account.passwordHash)) return { changed: false, reason: "same-password" };
  const updated = {
    ...account,
    passwordHash: passwordHash(next, { salt: randomBytes(16).toString("hex") }),
    updatedAt: new Date().toISOString()
  };
  await persistAccount(updated, env);
  return { changed: true, reason: "" };
}

export async function createStoredOwnerAccount({
  email,
  username = "",
  password,
  tenantId,
  displayName = ""
}, env = process.env) {
  const normalizedEmail = normalizeLogin(email);
  const normalizedUsername = normalizeLogin(username);
  const normalizedTenant = normalizeTenantId(tenantId, "");
  if (!normalizedEmail || !normalizedTenant || !String(password ?? "")) {
    throw new Error("Dati account incompleti.");
  }

  const account = {
    id: randomUUID(),
    tenantId: normalizedTenant,
    username: normalizedUsername,
    email: normalizedEmail,
    displayName: clean(displayName),
    role: "owner",
    passwordHash: passwordHash(password, { salt: randomBytes(16).toString("hex") }),
    disabled: false,
    emailVerified: false,
    emailVerifiedAt: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const serialized = JSON.stringify(account);
  const emailKey = accountLoginKey(normalizedEmail);
  const reserved = await redisCommand(env, "SET", emailKey, serialized, "NX");
  if (String(reserved).toUpperCase() !== "OK") return { created: false, reason: "login-exists", account: null };

  try {
    if (normalizedUsername && normalizedUsername !== normalizedEmail) {
      const usernameReserved = await redisCommand(env, "SET", accountLoginKey(normalizedUsername), serialized, "NX");
      if (String(usernameReserved).toUpperCase() !== "OK") {
        await redisCommand(env, "DEL", emailKey);
        return { created: false, reason: "login-exists", account: null };
      }
    }
    await redisCommand(env, "SET", accountIdKey(account.id), serialized);
    await redisCommand(env, "SET", accountTenantOwnerKey(normalizedTenant), account.id);
  } catch (error) {
    await redisCommand(env, "DEL", emailKey).catch(() => {});
    if (normalizedUsername && normalizedUsername !== normalizedEmail) {
      await redisCommand(env, "DEL", accountLoginKey(normalizedUsername)).catch(() => {});
    }
    await redisCommand(env, "DEL", accountTenantOwnerKey(normalizedTenant)).catch(() => {});
    throw error;
  }

  return {
    created: true,
    reason: "",
    account: publicAccount(account)
  };
}
