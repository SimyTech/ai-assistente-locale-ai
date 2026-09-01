import test from "node:test";
import assert from "node:assert/strict";
import {
  authenticateStoredOwnerAccount,
  changeStoredOwnerPassword,
  createStoredOwnerAccount,
  updateStoredOwnerProfile
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

test("il titolare può aggiornare il nome visualizzato solo nel proprio tenant", async () => {
  const originalFetch = global.fetch;
  global.fetch = redisFetchMock();
  const env = {
    UPSTASH_REDIS_REST_URL: "https://redis.test",
    UPSTASH_REDIS_REST_TOKEN: "test-token"
  };

  try {
    const created = await createStoredOwnerAccount({
      email: "owner@example.com",
      password: "PasswordSicura!1",
      tenantId: "studio-uno",
      displayName: "Nome Vecchio"
    }, env);
    assert.equal(created.created, true);

    const wrongTenant = await updateStoredOwnerProfile({
      login: "owner@example.com",
      displayName: "Nome Nuovo",
      tenantId: "studio-due"
    }, env);
    assert.equal(wrongTenant.updated, false);
    assert.equal(wrongTenant.reason, "tenant-mismatch");

    const invalid = await updateStoredOwnerProfile({
      login: "owner@example.com",
      displayName: "A",
      tenantId: "studio-uno"
    }, env);
    assert.equal(invalid.updated, false);
    assert.equal(invalid.reason, "invalid-display-name");

    const updated = await updateStoredOwnerProfile({
      login: "owner@example.com",
      displayName: "Nome Nuovo",
      tenantId: "studio-uno"
    }, env);
    assert.equal(updated.updated, true);
    assert.equal(updated.account?.displayName, "Nome Nuovo");
    assert.equal(Object.hasOwn(updated.account || {}, "passwordHash"), false);

    const authenticated = await authenticateStoredOwnerAccount({
      login: "owner@example.com",
      password: "PasswordSicura!1"
    }, env);
    assert.equal(authenticated?.displayName, "Nome Nuovo");
  } finally {
    global.fetch = originalFetch;
  }
});
