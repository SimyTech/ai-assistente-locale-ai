import test from "node:test";
import assert from "node:assert/strict";
import { createRedisRateLimitFetch } from "../lib/redis-rate-limit-optimizer.js";

const REDIS_URL = "https://redis.example.test";
const RATE_KEY = "maviri:tenant:default:rate:book:0123456789abcdef01234567";

function response(result = 1) {
  return new Response(JSON.stringify({ result }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

test("INCR rate-limit diventa una singola EVAL con scadenza atomica", async () => {
  const calls = [];
  const optimizedFetch = createRedisRateLimitFetch(async (input, init) => {
    calls.push({ input, init });
    return response(1);
  }, REDIS_URL);

  const result = await optimizedFetch(REDIS_URL, {
    method: "POST",
    body: JSON.stringify(["INCR", RATE_KEY])
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);

  const command = JSON.parse(calls[0].init.body);
  assert.equal(command[0], "EVAL");
  assert.equal(command[2], "1");
  assert.equal(command[3], RATE_KEY);
  assert.equal(command[4], "300");
  assert.match(command[1], /redis\.call\('incr'/);
  assert.match(command[1], /redis\.call\('expire'/);
});

test("EXPIRE successivo non genera un secondo round-trip", async () => {
  let networkCalls = 0;
  const optimizedFetch = createRedisRateLimitFetch(async () => {
    networkCalls += 1;
    return response(1);
  }, REDIS_URL);

  const result = await optimizedFetch(REDIS_URL, {
    method: "POST",
    body: JSON.stringify(["EXPIRE", RATE_KEY, "300"])
  });

  assert.equal(result.ok, true);
  assert.equal(networkCalls, 0);
  assert.deepEqual(await result.json(), { result: 1 });
});

test("comandi Redis non rate-limit restano invariati", async () => {
  const calls = [];
  const optimizedFetch = createRedisRateLimitFetch(async (input, init) => {
    calls.push({ input, init });
    return response("OK");
  }, REDIS_URL);

  const body = JSON.stringify(["SET", "maviri:tenant:default:owner-data", "{}"]);
  await optimizedFetch(REDIS_URL, { method: "POST", body });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.body, body);
});

test("richieste verso URL diversi non vengono intercettate", async () => {
  const calls = [];
  const optimizedFetch = createRedisRateLimitFetch(async (input, init) => {
    calls.push({ input, init });
    return response("OK");
  }, REDIS_URL);

  const body = JSON.stringify(["INCR", RATE_KEY]);
  await optimizedFetch("https://other.example.test", { method: "POST", body });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.body, body);
});
