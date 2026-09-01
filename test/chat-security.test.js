import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/chat.js";

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
