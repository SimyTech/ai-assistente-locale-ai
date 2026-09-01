import test from "node:test";
import assert from "node:assert/strict";
import registerHandler from "../api/register.js";
import authHandler from "../api/auth.js";
import { passwordHash } from "../lib/accounts.js";

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

function fakeRedis() {
  const values = new Map();
  return async (_url, options) => {
    const [command, ...args] = JSON.parse(options.body);
    let result = null;

    if (command === "GET") result = values.has(args[0]) ? values.get(args[0]) : null;
    if (command === "SET") {
      const [key, value, option] = args;
      if (String(option || "").toUpperCase() === "NX" && values.has(key)) result = null;
      else { values.set(key, value); result = "OK"; }
    }
    if (command === "DEL") result = values.delete(args[0]) ? 1 : 0;
    if (command === "INCR") {
      const next = Number(values.get(args[0]) || 0) + 1;
      values.set(args[0], next);
      result = next;
    }
    if (command === "EXPIRE") result = 1;

    return { ok: true, json: async () => ({ result }) };
  };
}

async function call(handler, method, body = {}, headers = {}) {
  const res = response();
  await handler({
    method,
    body,
    headers,
    socket: { remoteAddress: "203.0.113.80" }
  }, res);
  return res;
}

function configureRuntime() {
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "redis-token";
  process.env.MAVIRI_SESSION_SECRET = "registration-session-secret";
}

function cleanupRuntime() {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.MAVIRI_SESSION_SECRET;
  delete process.env.MAVIRI_OWNER_ACCOUNTS;
}

test("registra una nuova attività e permette subito il login", async () => {
  const originalFetch = globalThis.fetch;
  configureRuntime();
  globalThis.fetch = fakeRedis();

  try {
    const created = await call(registerHandler, "POST", {
      businessName: "Officina Rossi",
      ownerName: "Mario Rossi",
      email: "mario@example.test",
      password: "Password!12345"
    });

    assert.equal(created.statusCode, 201);
    assert.equal(created.payload.authenticated, true);
    assert.equal(created.payload.needsSetup, true);
    assert.match(created.payload.tenantId, /^officina-rossi-[a-f0-9]{6}$/);
    assert.equal(created.payload.account.email, "mario@example.test");
    assert.match(created.headers["Set-Cookie"], /HttpOnly/);

    const login = await call(authHandler, "POST", {
      email: "mario@example.test",
      password: "Password!12345"
    });
    assert.equal(login.statusCode, 200);
    assert.equal(login.payload.authenticated, true);
    assert.equal(login.payload.tenantId, created.payload.tenantId);
    assert.equal(login.payload.account.email, "mario@example.test");
  } finally {
    globalThis.fetch = originalFetch;
    cleanupRuntime();
  }
});

test("non permette due account Redis con la stessa email", async () => {
  const originalFetch = globalThis.fetch;
  configureRuntime();
  globalThis.fetch = fakeRedis();

  try {
    const body = {
      businessName: "Studio Uno",
      email: "owner@example.test",
      password: "Password!12345"
    };
    const first = await call(registerHandler, "POST", body, { "x-forwarded-for": "198.51.100.12" });
    const second = await call(registerHandler, "POST", { ...body, businessName: "Studio Due" }, { "x-forwarded-for": "198.51.100.13" });
    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 409);
    assert.match(second.payload.error, /già un account/i);
  } finally {
    globalThis.fetch = originalFetch;
    cleanupRuntime();
  }
});

test("non collide con account storici configurati via ambiente", async () => {
  const originalFetch = globalThis.fetch;
  configureRuntime();
  globalThis.fetch = fakeRedis();
  process.env.MAVIRI_OWNER_ACCOUNTS = JSON.stringify({
    storico: {
      tenantId: "studio-storico",
      username: "storico",
      email: "owner@example.test",
      passwordHash: passwordHash("Password!999", {
        salt: "abcdefabcdefabcdefabcdefabcdefab",
        iterations: 100000
      })
    }
  });

  try {
    const denied = await call(registerHandler, "POST", {
      businessName: "Nuovo Studio",
      email: "OWNER@example.test",
      password: "Password!12345"
    }, { "x-forwarded-for": "198.51.100.22" });
    assert.equal(denied.statusCode, 409);
    assert.match(denied.payload.error, /già un account/i);
  } finally {
    globalThis.fetch = originalFetch;
    cleanupRuntime();
  }
});

test("valida email e robustezza minima della password", async () => {
  const originalFetch = globalThis.fetch;
  configureRuntime();
  globalThis.fetch = fakeRedis();

  try {
    const badEmail = await call(registerHandler, "POST", {
      businessName: "Studio Test",
      email: "non-email",
      password: "Password!12345"
    });
    assert.equal(badEmail.statusCode, 400);

    const weakPassword = await call(registerHandler, "POST", {
      businessName: "Studio Test",
      email: "test@example.test",
      password: "123"
    });
    assert.equal(weakPassword.statusCode, 400);
    assert.match(weakPassword.payload.error, /10 caratteri/);
  } finally {
    globalThis.fetch = originalFetch;
    cleanupRuntime();
  }
});
