import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/auth.js";

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

async function call(method, body = {}, headers = {}) {
  const res = response();
  await handler({
    method,
    body,
    headers,
    socket: { remoteAddress: "203.0.113.50" }
  }, res);
  return res;
}

function fakeRedis() {
  const values = new Map();
  return async (_url, options) => {
    const [command, ...args] = JSON.parse(options.body);
    let result = null;

    if (command === "INCR") {
      const next = Number(values.get(args[0]) || 0) + 1;
      values.set(args[0], next);
      result = next;
    }
    if (command === "EXPIRE") result = 1;
    if (command === "DEL") result = values.delete(args[0]) ? 1 : 0;

    return { ok: true, json: async () => ({ result }) };
  };
}

test("login imposta un cookie HttpOnly e la sessione autorizza le richieste successive", async () => {
  process.env.MAVIRI_OWNER_SYNC_TOKEN = "owner-secret";
  process.env.MAVIRI_SESSION_SECRET = "independent-session-secret";
  try {
    const login = await call("POST", { tenantId: "default", token: "owner-secret" });
    assert.equal(login.statusCode, 200);
    assert.match(login.headers["Set-Cookie"], /HttpOnly/);
    assert.match(login.headers["Set-Cookie"], /SameSite=Strict/);

    const cookie = login.headers["Set-Cookie"].split(";")[0];
    const status = await call("GET", { tenantId: "default" }, { cookie });
    assert.equal(status.statusCode, 200);
    assert.equal(status.payload.authenticated, true);
  } finally {
    delete process.env.MAVIRI_OWNER_SYNC_TOKEN;
    delete process.env.MAVIRI_SESSION_SECRET;
  }
});

test("login rifiuta credenziali errate e logout cancella il cookie", async () => {
  process.env.MAVIRI_OWNER_SYNC_TOKEN = "owner-secret";
  try {
    const denied = await call("POST", { tenantId: "default", token: "wrong" });
    assert.equal(denied.statusCode, 401);
    const logout = await call("DELETE", { tenantId: "default" });
    assert.equal(logout.statusCode, 200);
    assert.match(logout.headers["Set-Cookie"], /Max-Age=0/);
  } finally {
    delete process.env.MAVIRI_OWNER_SYNC_TOKEN;
  }
});

test("blocca i tentativi ripetuti di login per tenant e IP", async () => {
  const originalFetch = globalThis.fetch;
  process.env.MAVIRI_OWNER_SYNC_TOKEN = "owner-secret";
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "redis-token";
  globalThis.fetch = fakeRedis();

  try {
    let last;
    for (let i = 0; i < 9; i += 1) {
      last = await call(
        "POST",
        { tenantId: "default", token: "wrong" },
        { "x-forwarded-for": "198.51.100.44, 10.0.0.1" }
      );
    }

    assert.equal(last.statusCode, 429);
    assert.equal(last.payload.authenticated, false);
    assert.match(last.payload.error, /Troppi tentativi/);
    assert.equal(last.headers["X-RateLimit-Limit"], "8");
    assert.equal(last.headers["X-RateLimit-Remaining"], "0");
    assert.equal(last.headers["Retry-After"], "900");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.MAVIRI_OWNER_SYNC_TOKEN;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  }
});

test("un login corretto azzera il contatore dei tentativi falliti", async () => {
  const originalFetch = globalThis.fetch;
  process.env.MAVIRI_OWNER_SYNC_TOKEN = "owner-secret";
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "redis-token";
  globalThis.fetch = fakeRedis();

  try {
    for (let i = 0; i < 4; i += 1) {
      const denied = await call("POST", { tenantId: "default", token: "wrong" });
      assert.equal(denied.statusCode, 401);
    }

    const login = await call("POST", { tenantId: "default", token: "owner-secret" });
    assert.equal(login.statusCode, 200);

    for (let i = 0; i < 8; i += 1) {
      const denied = await call("POST", { tenantId: "default", token: "wrong" });
      assert.equal(denied.statusCode, 401);
    }
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.MAVIRI_OWNER_SYNC_TOKEN;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  }
});
