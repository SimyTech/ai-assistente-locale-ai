import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/auth.js";
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

test("account username/password seleziona automaticamente il tenant", async () => {
  process.env.MAVIRI_SESSION_SECRET = "account-session-secret";
  process.env.MAVIRI_OWNER_ACCOUNTS = JSON.stringify({
    anna: {
      tenantId: "salone-anna",
      username: "anna",
      email: "anna@example.test",
      displayName: "Anna",
      role: "owner",
      passwordHash: passwordHash("Password!123", {
        salt: "abcdefabcdefabcdefabcdefabcdefab",
        iterations: 100000
      })
    }
  });

  try {
    const login = await call("POST", {
      email: "ANNA@example.test",
      password: "Password!123"
    });

    assert.equal(login.statusCode, 200);
    assert.equal(login.payload.authenticated, true);
    assert.equal(login.payload.tenantId, "salone-anna");
    assert.equal(login.payload.account.username, "anna");
    assert.equal(login.payload.account.displayName, "Anna");
    assert.equal(login.payload.legacyTokenLogin, false);
    assert.match(login.headers["Set-Cookie"], /HttpOnly/);

    const cookie = login.headers["Set-Cookie"].split(";")[0];
    const correctTenant = await call("GET", { tenantId: "salone-anna" }, { cookie });
    assert.equal(correctTenant.statusCode, 200);
    const wrongTenant = await call("GET", { tenantId: "barber-luca" }, { cookie });
    assert.equal(wrongTenant.statusCode, 401);
  } finally {
    delete process.env.MAVIRI_SESSION_SECRET;
    delete process.env.MAVIRI_OWNER_ACCOUNTS;
  }
});

test("account non può dichiarare il tenant di un'altra attività", async () => {
  process.env.MAVIRI_SESSION_SECRET = "account-session-secret";
  process.env.MAVIRI_OWNER_ACCOUNTS = JSON.stringify({
    anna: {
      tenantId: "salone-anna",
      username: "anna",
      passwordHash: passwordHash("Password!456", {
        salt: "00110011001100110011001100110011",
        iterations: 100000
      })
    }
  });

  try {
    const denied = await call("POST", {
      tenantId: "barber-luca",
      username: "anna",
      password: "Password!456"
    });
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.payload.authenticated, false);
  } finally {
    delete process.env.MAVIRI_SESSION_SECRET;
    delete process.env.MAVIRI_OWNER_ACCOUNTS;
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
