import test from "node:test";
import assert from "node:assert/strict";
import chatHandler from "../api/chat.js";

function response() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    on() { return this; }
  };
}

function redisResponse(result) {
  return {
    ok: true,
    status: 200,
    async json() {
      return { result };
    }
  };
}

test("simula 200 chat concorrenti e protegge il tenant oltre la soglia", async () => {
  const oldFetch = globalThis.fetch;
  const oldEnv = {
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN
  };
  const counters = new Map();
  const tenantData = {
    business: { name: "Demo carico" },
    settings: {},
    services: [],
    promotions: [],
    clients: [],
    appointments: []
  };

  process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";

  globalThis.fetch = async (_url, options) => {
    const [command, key] = JSON.parse(options.body);

    if (command === "INCR") {
      const next = (counters.get(key) || 0) + 1;
      counters.set(key, next);
      return redisResponse(next);
    }

    if (command === "EXPIRE") return redisResponse(1);
    if (command === "GET") return redisResponse(JSON.stringify(tenantData));
    throw new Error(`Comando Redis inatteso: ${command}`);
  };

  try {
    const startedAt = Date.now();
    const results = await Promise.all(
      Array.from({ length: 200 }, async (_, index) => {
        const res = response();
        await chatHandler({
          method: "POST",
          headers: {
            "x-forwarded-for": `203.0.113.${index + 1}`
          },
          body: {
            action: "chat",
            mode: "client",
            tenantId: "demo-carico",
            message: "ciao",
            history: []
          }
        }, res);
        return res;
      })
    );

    const accepted = results.filter(item => item.statusCode === 200);
    const limited = results.filter(item => item.statusCode === 429);

    assert.equal(accepted.length, 180);
    assert.equal(limited.length, 20);
    assert.ok(Date.now() - startedAt < 5000);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldEnv.url === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = oldEnv.url;
    if (oldEnv.token === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = oldEnv.token;
  }
});
