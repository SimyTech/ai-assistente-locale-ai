import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/chat.js";
import { createSession } from "../lib/session.js";

function response() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

async function request(body, headers = {}) {
  const res = response();
  await handler({ method: "POST", headers, body }, res);
  return res;
}

test("rifiuta metodi diversi da POST", async () => {
  const res = response();
  await handler({ method: "GET", headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.payload.ok, false);
});

test("rifiuta una mutazione owner senza autenticazione", async () => {
  process.env.MAVIRI_OWNER_SYNC_TOKEN = "test-secret";
  const res = await request({ action: "cancel", mode: "owner", id: "appointment-1" });
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.error, "Autenticazione proprietario richiesta.");
});

test("accetta il token owner corretto per il tenant default", async () => {
  process.env.MAVIRI_OWNER_SYNC_TOKEN = "test-secret";
  const res = await request(
    { action: "cancel", mode: "owner", id: "appointment-1" },
    { "x-maviri-owner-token": "test-secret", "x-maviri-tenant": "default" }
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.cancelled, true);
  assert.equal(res.payload.persisted, false);
});

test("accetta la sessione account per una mutazione owner senza token legacy", async () => {
  const previousSessionSecret = process.env.MAVIRI_SESSION_SECRET;
  const previousOwnerToken = process.env.MAVIRI_OWNER_SYNC_TOKEN;
  process.env.MAVIRI_SESSION_SECRET = "account-session-secret";
  delete process.env.MAVIRI_OWNER_SYNC_TOKEN;
  const session = createSession({ tenantId: "default", secret: "account-session-secret" });

  try {
    const res = await request(
      { action: "cancel", mode: "owner", tenantId: "default", id: "appointment-1" },
      { cookie: `maviri_session=${encodeURIComponent(session)}`, "x-maviri-tenant": "default" }
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.cancelled, true);
  } finally {
    if (previousSessionSecret === undefined) delete process.env.MAVIRI_SESSION_SECRET;
    else process.env.MAVIRI_SESSION_SECRET = previousSessionSecret;
    if (previousOwnerToken === undefined) delete process.env.MAVIRI_OWNER_SYNC_TOKEN;
    else process.env.MAVIRI_OWNER_SYNC_TOKEN = previousOwnerToken;
  }
});

test("non consente a un token di operare su un altro tenant", async () => {
  process.env.MAVIRI_OWNER_TOKENS = JSON.stringify({ "salone-uno": "token-a", "salone-due": "token-b" });
  const res = await request(
    { action: "cancel", mode: "owner", id: "appointment-1" },
    { "x-maviri-owner-token": "token-a", "x-maviri-tenant": "salone-due" }
  );
  assert.equal(res.statusCode, 401);
  delete process.env.MAVIRI_OWNER_TOKENS;
});

test("blocca payload oltre un megabyte", async () => {
  const res = await request({ action: "chat", mode: "client", message: "x".repeat(1024 * 1024) });
  assert.equal(res.statusCode, 413);
});

test("rifiuta un tenant esplicito malformato senza usare quello default", async () => {
  const res = await request(
    { action: "cancel", mode: "owner", id: "appointment-1" },
    { "x-maviri-tenant": "../default" }
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.error, "Identificativo attività non valido.");
});
