import test from "node:test";
import assert from "node:assert/strict";
import {
  createRedisRateLimitFetch,
  getRedisOptimizationMetrics,
  runWithRedisOptimizationContext
} from "../lib/redis-rate-limit-optimizer.js";

const REDIS_URL = "https://redis.example.test";

function pipelineResponse(results) {
  return new Response(JSON.stringify(results.map(result => ({ result }))), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

for (const action of ["availability", "chat"]) {
  test(`${action} unisce rate limit e owner-data in un solo round-trip`, async () => {
    const calls = [];
    const ownerJson = JSON.stringify({ revision: 9, action });
    const rateKey = `maviri:tenant:negozio:rate:${action}:0123456789abcdef01234567`;
    const ownerKey = "maviri:tenant:negozio:owner-data";

    const optimizedFetch = createRedisRateLimitFetch(async (input, init) => {
      calls.push({ input, init });
      return pipelineResponse([1, ownerJson]);
    }, REDIS_URL);

    await runWithRedisOptimizationContext(async () => {
      const rate = await optimizedFetch(REDIS_URL, {
        method: "POST",
        body: JSON.stringify(["INCR", rateKey])
      });
      assert.deepEqual(await rate.json(), { result: 1 });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].input, `${REDIS_URL}/pipeline`);

      const commands = JSON.parse(calls[0].init.body);
      assert.equal(commands[0][0], "EVAL");
      assert.deepEqual(commands[1], ["GET", ownerKey]);

      const owner = await optimizedFetch(REDIS_URL, {
        method: "POST",
        body: JSON.stringify(["GET", ownerKey])
      });
      assert.deepEqual(await owner.json(), { result: ownerJson });
      assert.equal(calls.length, 1);

      const metrics = getRedisOptimizationMetrics();
      assert.equal(metrics.redisCalls, 1);
      assert.equal(metrics.redisPipelines, 1);
    });
  });
}
