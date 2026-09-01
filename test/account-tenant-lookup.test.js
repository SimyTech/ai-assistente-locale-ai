import test from "node:test";
import assert from "node:assert/strict";
import {
  createStoredOwnerAccount,
  getStoredOwnerAccountByTenant,
  markStoredOwnerEmailVerified
} from "../lib/account-store.js";

function redisFetchMock() {
  const store = new Map();
  return async (_url, options = {}) => {
    const [command, ...args] = JSON.parse(options.body || "[]");
    const cmd = String(command || "").toUpperCase();
    let result = null;
    if (cmd === "GET") result = store.has(args[0]) ? store.get(args[0]) : null;
    else if (cmd === "SET") {
      const [key, value, mode] = args;
      if (String(mode || "").toUpperCase() === "NX" && store.has(key)) result = null;
      else { store.set(key, value); result = "OK"; }
    } else if (cmd === "DEL") result = store.delete(args[0]) ? 1 : 0;
    else throw new Error(`Comando Redis non gestito nel test: ${cmd}`);
    return { ok: true, async json() { return { result }; } };
  };
}

test("l'account proprietario è recuperabile dal tenant e resta aggiornato", async () => {
  const originalFetch = global.fetch;
  global.fetch = redisFetchMock();
  const env = { UPSTASH_REDIS_REST_URL: "https://redis.test", UPSTASH_REDIS_REST_TOKEN: "test-token" };
  try {
    const created = await createStoredOwnerAccount({
      email: "owner@example.com",
      password: "PasswordSicura!1",
      tenantId: "studio-uno",
      displayName: "Owner"
    }, env);
    assert.equal(created.created, true);

    const before = await getStoredOwnerAccountByTenant("studio-uno", env);
    assert.equal(before?.email, "owner@example.com");
    assert.equal(before?.emailVerified, false);
    assert.equal(before?.passwordHash, undefined);

    const verified = await markStoredOwnerEmailVerified({ login: "owner@example.com", tenantId: "studio-uno" }, env);
    assert.equal(verified.verified, true);

    const after = await getStoredOwnerAccountByTenant("studio-uno", env);
    assert.equal(after?.emailVerified, true);
    assert.ok(after?.emailVerifiedAt);
    assert.equal(after?.passwordHash, undefined);
  } finally {
    global.fetch = originalFetch;
  }
});
