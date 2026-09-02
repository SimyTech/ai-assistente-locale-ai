import test from "node:test";
import assert from "node:assert/strict";
import {
  createRedisRateReadFetch,
  getRedisRateReadMetrics,
  runWithRedisRateReadContext
} from "../lib/redis-rate-read-optimizer.js";

const REDIS_URL = "https://redis.example.test";

function pipelineResponse(rate = 1, data = "{\"ok\":true}") {
  return new Response(JSON.stringify([
    { result: rate },
    { result: data }
  ]), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function response(result = 1) {
  return new Response(JSON.stringify({ result }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

for (const action of ["book", "update", "cancel", "availability", "context"]) {
  test(`${action}: rate limit e prima lettura owner-data condividono una pipeline`, async () => {
    const calls = [];
    const optimizedFetch = createRedisRateReadFetch(async (input, init) => {
      calls.push({ input, init });
      return pipelineResponse(1, `{\"action\":\"${action}\"}`);
    }, REDIS_URL);

    await runWithRedisRateReadContext(async () => {
      const rateKey = `maviri:tenant:negozio:rate:${action}:0123456789abcdef01234567`;
      const rate = await optimizedFetch(REDIS_URL, {
        method: "POST",
        body: JSON.stringify(["INCR", rateKey])
      });
      assert.deepEqual(await rate.json(), { result: 1 });

      const data = await optimizedFetch(REDIS_URL, {
        method: "POST",
        body: JSON.stringify(["GET", "maviri:tenant:negozio:owner-data"])
      });
      assert.deepEqual(await data.json(), { result: `{\"action\":\"${action}\"}` });

      const metrics = getRedisRateReadMetrics();
      assert.deepEqual(metrics, {
        redisCalls: 1,
        redisPipelines: 1,
        syntheticResponses: 2
      });
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].input, `${REDIS_URL}/pipeline`);
    const commands = JSON.parse(calls[0].init.body);
    assert.equal(commands[0][0], "EVAL");
    assert.deepEqual(commands[1], ["GET", "maviri:tenant:negozio:owner-data"]);
  });
}

test("tenant default usa la chiave owner-data legacy", async () => {
  const calls = [];
  const optimizedFetch = createRedisRateReadFetch(async (input, init) => {
    calls.push({ input, init });
    return pipelineResponse();
  }, REDIS_URL);

  await runWithRedisRateReadContext(async () => {
    await optimizedFetch(REDIS_URL, {
      method: "POST",
      body: JSON.stringify([
        "INCR",
        "maviri:tenant:default:rate:update:0123456789abcdef01234567"
      ])
    });
  });

  const commands = JSON.parse(calls[0].init.body);
  assert.deepEqual(commands[1], ["GET", "maviri:owner-data"]);
});

test("public-context non viene trasformato nel fast path owner-data", async () => {
  const calls = [];
  const optimizedFetch = createRedisRateReadFetch(async (input, init) => {
    calls.push({ input, init });
    return response(1);
  }, REDIS_URL);

  await runWithRedisRateReadContext(async () => {
    const body = JSON.stringify([
      "INCR",
      "maviri:tenant:negozio:rate:public-context:0123456789abcdef01234567"
    ]);
    await optimizedFetch(REDIS_URL, { method: "POST", body });
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, REDIS_URL);
});

test("le letture prefetched restano isolate tra richieste concorrenti", async () => {
  const optimizedFetch = createRedisRateReadFetch(async (input, init) => {
    const commands = JSON.parse(init.body);
    const getKey = commands[1][1];
    return pipelineResponse(1, getKey.includes(":a:") ? "A" : "B");
  }, REDIS_URL);

  const results = await Promise.all(["a", "b"].map(tenant =>
    runWithRedisRateReadContext(async () => {
      await optimizedFetch(REDIS_URL, {
        method: "POST",
        body: JSON.stringify([
          "INCR",
          `maviri:tenant:${tenant}:rate:cancel:0123456789abcdef01234567`
        ])
      });
      await Promise.resolve();
      const data = await optimizedFetch(REDIS_URL, {
        method: "POST",
        body: JSON.stringify(["GET", `maviri:tenant:${tenant}:owner-data`])
      });
      return (await data.json()).result;
    })
  ));

  assert.deepEqual(results, ["A", "B"]);
});
