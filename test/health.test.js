import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/health.js";

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

function call() {
  const res = response();
  handler({ method: "GET" }, res);
  return res;
}

function cleanup() {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.MAVIRI_SESSION_SECRET;
  delete process.env.WHATSAPP_VERIFY_TOKEN;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  delete process.env.WHATSAPP_APP_SECRET;
}

test("health richiede Redis e sessioni per dichiarare il SaaS pronto", () => {
  cleanup();
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "token";
  let res = call();
  assert.equal(res.statusCode, 503);
  assert.equal(res.payload.checks.redis, true);
  assert.equal(res.payload.checks.sessions, false);

  process.env.MAVIRI_SESSION_SECRET = "session-secret";
  res = call();
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ready, true);
  assert.equal(res.payload.checks.registration, true);
  cleanup();
});

test("WhatsApp è una capability separata dalla disponibilità core", () => {
  cleanup();
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "token";
  process.env.MAVIRI_SESSION_SECRET = "session-secret";
  const res = call();
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.checks.whatsappBridge, false);
  assert.equal(res.payload.checks.whatsappSignature, false);
  cleanup();
});
