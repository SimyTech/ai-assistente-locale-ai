import test from "node:test";
import assert from "node:assert/strict";
import {
  authenticateStoredOwnerAccount,
  changeStoredOwnerPassword,
  createStoredOwnerAccount
} from "../lib/account-store.js";

function redisFetchMock() {
  const store = new Map();
  return async (_url, options = {}) => {
    const [command, ...args] = JSON.parse(options.body || "[]");
    const cmd = String(command || "").toUpperCase();
    let result = null;

    if (cmd === "GET") {
      result = store.has(args[0]) ? store.get(args[0]) : null;
    } else if (cmd === "SET") {
      const [key, value, mode] = args;
      if (String(mode || "").toUpperCase() === "NX" && store.has(key)) result = null;
      else { store.set(key, value); result = "OK"; }
    } else if (cmd === "DEL") {
      result = store.delete(args[0]) ? 1 : 0;
    } else {
      throw new Error(`Comando Redis non gestito nel test: ${cmd}`);
    }

    return {
      ok: true,
      async json() { return { result }; }
    };
  };
}

test("il titolare può cambiare password senza esporla o cambiare tenant", async () => {
  const originalFetch = global.fetch;
  global.fetch = redisFetchMock();
  const env = {
    UPSTASH_REDIS_REST_URL: "https://redis.test",
    UPSTASH_REDIS_REST_TOKEN: "test-token"
  };

  try {
    const created = await createStoredOwnerAccount({
      email: "titolare@example.com",
      username: "titolare",
      password: "PasswordVecchia!1",
      tenantId: "attivita-uno",
      displayName: "Titolare"
    }, env);
    assert.equal(created.created, true);

    const wrongTenant = await changeStoredOwnerPassword({
      login: "titolare@example.com",
      currentPassword: "PasswordVecchia!1",
      newPassword: "PasswordNuova!2",
      tenantId: "attivita-due"
    }, env);
    assert.deepEqual(wrongTenant, { changed: false, reason: "tenant-mismatch" });

    const wrongCurrent = await changeStoredOwnerPassword({
      login: "titolare@example.com",
      currentPassword: "PasswordErrata!1",
      newPassword: "PasswordNuova!2",
      tenantId: "attivita-uno"
    }, env);
    assert.deepEqual(wrongCurrent, { changed: false, reason: "invalid-credentials" });

    const changed = await changeStoredOwnerPassword({
      login: "titolare@example.com",
      currentPassword: "PasswordVecchia!1",
      newPassword: "PasswordNuova!2",
      tenantId: "attivita-uno"
    }, env);
    assert.equal(changed.changed, true);

    assert.equal(await authenticateStoredOwnerAccount({
      login: "titolare@example.com",
      password: "PasswordVecchia!1"
    }, env), null);

    const authenticated = await authenticateStoredOwnerAccount({
      login: "titolare",
      password: "PasswordNuova!2"
    }, env);
    assert.equal(authenticated?.tenantId, "attivita-uno");
    assert.equal(authenticated?.email, "titolare@example.com");
  } finally {
    global.fetch = originalFetch;
  }
});
