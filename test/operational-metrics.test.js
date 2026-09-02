import test from "node:test";
import assert from "node:assert/strict";
import { attachOperationalMetrics } from "../lib/operational-metrics.js";
import {
  createRedisRateLimitFetch,
  getRedisOptimizationMetrics,
  runWithRedisOptimizationContext
} from "../lib/redis-rate-limit-optimizer.js";

const REDIS_URL = "https://redis.example.test";

function redisResponse(result = 1) {
  return new Response(JSON.stringify({ result }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function fakeResponse() {
  const headers = new Map();
  return {
    headersSent: false,
    writableEnded: false,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), String(value));
    },
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
    end() {
      this.writableEnded = true;
      this.headersSent = true;
    }
  };
}

test("le metriche Redis sono isolate per singola richiesta", async () => {
  const optimizedFetch = createRedisRateLimitFetch(async () => redisResponse("OK"), REDIS_URL);

  await Promise.all([
    runWithRedisOptimizationContext(async () => {
      await optimizedFetch(REDIS_URL, {
        method: "POST",
        body: JSON.stringify(["GET", "maviri:tenant:a:owner-data"])
      });
      assert.equal(getRedisOptimizationMetrics().redisCalls, 1);
    }),
    runWithRedisOptimizationContext(async () => {
      await optimizedFetch(REDIS_URL, {
        method: "POST",
        body: JSON.stringify(["GET", "maviri:tenant:b:owner-data"])
      });
      await optimizedFetch(REDIS_URL, {
        method: "POST",
        body: JSON.stringify(["GET", "maviri:tenant:b:public-context"])
      });
      assert.equal(getRedisOptimizationMetrics().redisCalls, 2);
    })
  ]);
});

test("gli header operativi riportano tempo e round-trip Redis senza dati cliente", async () => {
  const req = { body: { action: "cancel" } };
  const res = fakeResponse();
  const optimizedFetch = createRedisRateLimitFetch(async () => redisResponse("OK"), REDIS_URL);

  await runWithRedisOptimizationContext(async () => {
    await attachOperationalMetrics(req, res, async () => {
      await optimizedFetch(REDIS_URL, {
        method: "POST",
        body: JSON.stringify(["GET", "maviri:tenant:negozio:owner-data"])
      });
      res.end("ok");
    });
  });

  assert.equal(res.getHeader("X-Maviri-Operation"), "cancel");
  assert.equal(res.getHeader("X-Maviri-Redis-Calls"), "1");
  assert.equal(res.getHeader("X-Maviri-Redis-Pipelines"), "0");
  assert.match(res.getHeader("X-Maviri-Server-Ms"), /^\d+(?:\.\d)$/);
  assert.match(res.getHeader("Server-Timing"), /maviri;dur=/);
  assert.match(res.getHeader("Server-Timing"), /redis;desc="1 calls\/0 pipelines"/);
});

test("una pipeline conta come un solo round-trip di rete", async () => {
  const optimizedFetch = createRedisRateLimitFetch(async input => {
    if (String(input).endsWith("/pipeline")) {
      return new Response(JSON.stringify([
        { result: "OK" },
        { result: "{}" }
      ]), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    return redisResponse("OK");
  }, REDIS_URL);

  await runWithRedisOptimizationContext(async () => {
    await optimizedFetch(REDIS_URL, {
      method: "POST",
      body: JSON.stringify([
        "SET",
        "maviri:tenant:negozio:booking-lock:slot",
        "token",
        "NX",
        "PX",
        "15000"
      ])
    });

    const metrics = getRedisOptimizationMetrics();
    assert.equal(metrics.redisCalls, 1);
    assert.equal(metrics.redisPipelines, 1);
  });
});

test("le risposte sintetiche non vengono conteggiate come round-trip", async () => {
  const optimizedFetch = createRedisRateLimitFetch(async () => redisResponse(1), REDIS_URL);
  const rateKey = "maviri:tenant:default:rate:book:0123456789abcdef01234567";

  await runWithRedisOptimizationContext(async () => {
    await optimizedFetch(REDIS_URL, {
      method: "POST",
      body: JSON.stringify(["EXPIRE", rateKey, "300"])
    });

    const metrics = getRedisOptimizationMetrics();
    assert.equal(metrics.redisCalls, 0);
    assert.equal(metrics.syntheticResponses, 1);
  });
});
