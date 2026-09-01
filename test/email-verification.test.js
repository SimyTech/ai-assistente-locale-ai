import test from "node:test";
import assert from "node:assert/strict";
import { accountLoginKey, authenticateStoredOwnerAccount, createStoredOwnerAccount } from "../lib/account-store.js";
import { consumeEmailVerification, emailVerificationKey, requestEmailVerification } from "../lib/email-verification.js";

function fetchMock() {
  const store = new Map();
  let verificationToken = "";

  const mock = async (url, options = {}) => {
    if (String(url) === "https://api.resend.com/emails") {
      const body = JSON.parse(options.body || "{}");
      const match = String(body.html || "").match(/verify-email\?token=([a-f0-9]+)/i);
      verificationToken = match?.[1] || "";
      return { ok: true, async json() { return { id: "email-test" }; } };
    }

    const [command, ...args] = JSON.parse(options.body || "[]");
    const cmd = String(command || "").toUpperCase();
    let result = null;
    if (cmd === "GET") {
      result = store.has(args[0]) ? store.get(args[0]) : null;
    } else if (cmd === "GETDEL") {
      result = store.has(args[0]) ? store.get(args[0]) : null;
      store.delete(args[0]);
    } else if (cmd === "SET") {
      const [key, value, option] = args;
      if (String(option || "").toUpperCase() === "NX" && store.has(key)) result = null;
      else { store.set(key, value); result = "OK"; }
    } else if (cmd === "DEL") {
      result = store.delete(args[0]) ? 1 : 0;
    } else {
      throw new Error(`Comando Redis non gestito nel test: ${cmd}`);
    }
    return { ok: true, async json() { return { result }; } };
  };

  mock.token = () => verificationToken;
  mock.store = store;
  return mock;
}

test("la registrazione può verificare l'email con un token monouso", async () => {
  const originalFetch = global.fetch;
  const mock = fetchMock();
  global.fetch = mock;
  const env = {
    UPSTASH_REDIS_REST_URL: "https://redis.test",
    UPSTASH_REDIS_REST_TOKEN: "test-token",
    RESEND_API_KEY: "re_test",
    MAVIRI_EMAIL_FROM: "Maviri <noreply@example.com>",
    MAVIRI_PUBLIC_URL: "https://maviri.example"
  };

  try {
    const created = await createStoredOwnerAccount({
      email: "owner@example.com",
      password: "PasswordSicura!1",
      tenantId: "studio-uno",
      displayName: "Owner"
    }, env);
    assert.equal(created.created, true);
    assert.equal(created.account.emailVerified, false);

    const before = await authenticateStoredOwnerAccount({
      login: "owner@example.com",
      password: "PasswordSicura!1"
    }, env);
    assert.equal(before?.emailVerified, false);

    const wrongTenant = await requestEmailVerification("owner@example.com", env, "studio-due");
    assert.deepEqual(wrongTenant, { accepted: false, sent: false, reason: "tenant-mismatch" });

    const requested = await requestEmailVerification("owner@example.com", env, "studio-uno");
    assert.equal(requested.sent, true);
    const token = mock.token();
    assert.match(token, /^[a-f0-9]{64}$/);

    const tooSoon = await requestEmailVerification("owner@example.com", env, "studio-uno");
    assert.deepEqual(tooSoon, { accepted: false, sent: false, reason: "cooldown" });

    const verified = await consumeEmailVerification(token, env);
    assert.equal(verified.verified, true);

    const after = await authenticateStoredOwnerAccount({
      login: "owner@example.com",
      password: "PasswordSicura!1"
    }, env);
    assert.equal(after?.emailVerified, true);
    assert.ok(after?.emailVerifiedAt);

    const reused = await consumeEmailVerification(token, env);
    assert.deepEqual(reused, { verified: false, reason: "invalid-or-expired" });
  } finally {
    global.fetch = originalFetch;
  }
});

test("un vecchio token non può verificare un account diverso che riusa la stessa email", async () => {
  const originalFetch = global.fetch;
  const mock = fetchMock();
  const env = {
    UPSTASH_REDIS_REST_URL: "https://redis.test",
    UPSTASH_REDIS_REST_TOKEN: "redis-token",
    RESEND_API_KEY: "resend-token",
    MAVIRI_EMAIL_FROM: "Maviri <noreply@maviri.test>",
    MAVIRI_PUBLIC_URL: "https://maviri.test"
  };

  try {
    global.fetch = mock;
    const first = await createStoredOwnerAccount({
      email: "riusata@example.com",
      password: "PasswordSicura!1",
      tenantId: "tenant-originale"
    }, env);
    assert.equal(first.created, true);
    assert.equal((await requestEmailVerification("riusata@example.com", env)).sent, true);

    const token = mock.token();
    const tokenKey = emailVerificationKey(token);
    const tokenPayload = JSON.parse(mock.store.get(tokenKey));
    tokenPayload.tenantId = "tenant-nuovo";
    mock.store.set(tokenKey, JSON.stringify(tokenPayload));

    const secondAccount = {
      id: "account-diverso",
      tenantId: "tenant-nuovo",
      username: "",
      email: "riusata@example.com",
      displayName: "Nuovo titolare",
      role: "owner",
      passwordHash: "non-rilevante",
      disabled: false,
      emailVerified: false
    };
    mock.store.set(accountLoginKey("riusata@example.com"), JSON.stringify(secondAccount));

    const result = await consumeEmailVerification(token, env);
    assert.equal(result.verified, false);
    assert.equal(result.reason, "account-mismatch");
    assert.equal(JSON.parse(mock.store.get(accountLoginKey("riusata@example.com"))).emailVerified, false);
  } finally {
    global.fetch = originalFetch;
  }
});
