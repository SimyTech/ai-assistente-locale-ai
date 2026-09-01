import { pbkdf2Sync, timingSafeEqual } from "node:crypto";
import { normalizeTenantId } from "./tenant.js";

const HASH_PREFIX = "pbkdf2-sha256";
const DEFAULT_ITERATIONS = 210000;
const KEY_LENGTH = 32;

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeLogin(value) {
  return clean(value).toLowerCase();
}

function safeEqualHex(left, right) {
  try {
    const a = Buffer.from(clean(left), "hex");
    const b = Buffer.from(clean(right), "hex");
    return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function passwordHash(password, { salt, iterations = DEFAULT_ITERATIONS } = {}) {
  const normalizedSalt = clean(salt);
  if (!normalizedSalt) throw new Error("Salt password obbligatorio.");
  const rounds = Number(iterations);
  if (!Number.isInteger(rounds) || rounds < 100000) {
    throw new Error("Numero iterazioni password non valido.");
  }
  const digest = pbkdf2Sync(String(password ?? ""), normalizedSalt, rounds, KEY_LENGTH, "sha256").toString("hex");
  return `${HASH_PREFIX}$${rounds}$${normalizedSalt}$${digest}`;
}

export function verifyPassword(password, encoded) {
  const [prefix, rawIterations, salt, expected, extra] = clean(encoded).split("$");
  if (prefix !== HASH_PREFIX || extra || !salt || !expected) return false;
  const iterations = Number(rawIterations);
  if (!Number.isInteger(iterations) || iterations < 100000) return false;
  const actual = pbkdf2Sync(String(password ?? ""), salt, iterations, KEY_LENGTH, "sha256").toString("hex");
  return safeEqualHex(actual, expected);
}

export function ownerAccounts(env = process.env) {
  const configured = clean(env.MAVIRI_OWNER_ACCOUNTS);
  if (!configured) return [];

  try {
    const parsed = JSON.parse(configured);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];

    return Object.entries(parsed)
      .map(([accountId, value]) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        const tenantId = normalizeTenantId(value.tenantId || value.tenant, "");
        const username = normalizeLogin(value.username || accountId);
        const email = normalizeLogin(value.email);
        const password = clean(value.passwordHash || value.password_hash);
        if (!tenantId || !username || !password) return null;
        return {
          id: clean(accountId) || username,
          tenantId,
          username,
          email,
          displayName: clean(value.displayName || value.name),
          role: clean(value.role || "owner") || "owner",
          passwordHash: password,
          disabled: value.disabled === true
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function authenticateOwnerAccount({ login, password }, env = process.env) {
  const target = normalizeLogin(login);
  if (!target || !String(password ?? "")) return null;

  const account = ownerAccounts(env).find(candidate =>
    !candidate.disabled && (candidate.username === target || candidate.email === target)
  );

  if (!account || !verifyPassword(password, account.passwordHash)) return null;

  return {
    id: account.id,
    tenantId: account.tenantId,
    username: account.username,
    email: account.email,
    displayName: account.displayName,
    role: account.role
  };
}
