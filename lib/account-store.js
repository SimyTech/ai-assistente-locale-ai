import { createHash, randomBytes, randomUUID } from "node:crypto";
import { passwordHash, verifyPassword } from "./accounts.js";
import { normalizeTenantId } from "./tenant.js";

const clean = value => String(value ?? "").trim();
const normalizeLogin = value => clean(value).toLowerCase();
const redisUrl = env => env.UPSTASH_REDIS_REST_URL || "";
const redisToken = env => env.UPSTASH_REDIS_REST_TOKEN || "";

function loginDigest(login) {
  return createHash("sha256").update(normalizeLogin(login)).digest("hex");
}

export function accountLoginKey(login) {
  return `maviri:account:login:${loginDigest(login)}`;
}

export function accountIdKey(accountId) {
  return `maviri:account:id:${clean(accountId)}`;
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

export async function authenticateStoredOwnerAccount({ login, password }, env = process.env) {
  const account = await getStoredOwnerAccount(login, env);
  if (!account || account.disabled === true || !verifyPassword(password, account.passwordHash)) return null;
  const tenantId = normalizeTenantId(account.tenantId, "");
  if (!tenantId) return null;
  return {
    id: clean(account.id),
    tenantId,
    username: normalizeLogin(account.username),
    email: normalizeLogin(account.email),
    displayName: clean(account.displayName),
    role: clean(account.role || "owner") || "owner"
  };
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
  } catch (error) {
    await redisCommand(env, "DEL", emailKey).catch(() => {});
    if (normalizedUsername && normalizedUsername !== normalizedEmail) {
      await redisCommand(env, "DEL", accountLoginKey(normalizedUsername)).catch(() => {});
    }
    throw error;
  }

  return {
    created: true,
    reason: "",
    account: {
      id: account.id,
      tenantId: account.tenantId,
      username: account.username,
      email: account.email,
      displayName: account.displayName,
      role: account.role
    }
  };
}
