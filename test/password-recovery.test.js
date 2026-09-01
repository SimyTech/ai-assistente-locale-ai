import test from "node:test";
import assert from "node:assert/strict";
import { authenticateStoredOwnerAccount, createStoredOwnerAccount } from "../lib/account-store.js";
import { consumePasswordReset, requestPasswordReset } from "../lib/account-recovery.js";

function fetchMock() {
  const store = new Map();
  return async (url, options = {}) => {
    if (String(url).includes("api.resend.com")) {
      return { ok: true, async json() { return { id: "mail-1" }; } };
    }

    const [command, ...args] = JSON.parse(options.body || "[]");
    const cmd = String(command || "").toUpperCase();
    let result = null;
    if (cmd === "GET") result = store.has(args[0]) ? store.get(args[0]) : null;
    else if (cmd === "GETDEL") {
      result = store.has(args[0]) ? store.get(args[0]) : null;
      store.delete(args[0]);
    } else if (cmd === "SET") {
      const [key, value, mode] = args;
      if (String(mode || "").toUpperCase() === "NX" && store.has(key)) result = null;
      else { store.set(key, value); result = "OK"; }
    } else if (cmd === "DEL") result = store.delete(args[0]) ? 1 : 0;
    else throw new Error(`Comando Redis non gestito nel test: ${cmd}`);
    return { ok: true, async json() { return { result }; } };
  };
}

test("il recupero password usa token monouso e non rivela account inesistenti", async () => {
  const originalFetch = global.fetch;
  global.fetch = fetchMock();
  const env = {
    UPSTASH_REDIS_REST_URL: "https://redis.test",
    UPSTASH_REDIS_REST_TOKEN: "token",
    RESEND_API_KEY: "resend-test",
    MAVIRI_EMAIL_FROM: "Maviri <noreply@example.com>",
    MAVIRI_PUBLIC_URL: "https://maviri.example"
  };

  try {
    const created = await createStoredOwnerAccount({
      email: "owner@example.com",
      password: "PasswordVecchia!1",
      tenantId: "attivita-test",
      displayName: "Owner"
    }, env);
    assert.equal(created.created, true);

    const missing = await requestPasswordReset("nessuno@example.com", env);
    assert.deepEqual(missing, { accepted: true, sent: false });

    let capturedToken = "";
    const previousFetch = global.fetch;
    global.fetch = async (url, options = {}) => {
      if (String(url).includes("api.resend.com")) {
        const body = JSON.parse(options.body);
        const match = String(body.html).match(/token=([a-f0-9]+)/i);
        capturedToken = match?.[1] || "";
      }
      return previousFetch(url, options);
    };

    const requested = await requestPasswordReset("owner@example.com", env);
    assert.equal(requested.accepted, true);
    assert.equal(requested.sent, true);
    assert.ok(capturedToken.length >= 32);

    const changed = await consumePasswordReset({ token: capturedToken, newPassword: "PasswordNuova!2" }, env);
    assert.equal(changed.changed, true);

    const replay = await consumePasswordReset({ token: capturedToken, newPassword: "AltraPassword!3" }, env);
    assert.equal(replay.reason, "invalid-or-expired");

    assert.equal(await authenticateStoredOwnerAccount({ login: "owner@example.com", password: "PasswordVecchia!1" }, env), null);
    const auth = await authenticateStoredOwnerAccount({ login: "owner@example.com", password: "PasswordNuova!2" }, env);
    assert.equal(auth?.tenantId, "attivita-test");
  } finally {
    global.fetch = originalFetch;
  }
});
