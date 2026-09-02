import test from "node:test";
import assert from "node:assert/strict";
import {
  createRedisRateLimitFetch,
  runWithRedisOptimizationContext
} from "../lib/redis-rate-limit-optimizer.js";
import {
  createRedisRateReadFetch,
  runWithRedisRateReadContext
} from "../lib/redis-rate-read-optimizer.js";

const REDIS_URL = "https://redis.example.test";
const TENANT = "negozio";
const HASH = "0123456789abcdef01234567";
const OWNER_KEY = `maviri:tenant:${TENANT}:owner-data`;
const PUBLIC_KEY = `maviri:tenant:${TENANT}:public-context`;
const LOCK_KEY = `maviri:tenant:${TENANT}:booking-lock:2026-09-03|10:00|taglio`;

function redisResult(command) {
  const op = String(command?.[0] || "").toUpperCase();
  if (op === "GET") return "{}";
  if (op === "SET") return "OK";
  if (op === "INCR") return 1;
  if (op === "EXPIRE") return 1;
  if (op === "EVAL") return 1;
  return 1;
}

function redisResponse(result) {
  return new Response(JSON.stringify({ result }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function pipelineResponse(commands) {
  return new Response(JSON.stringify(commands.map(command => ({ result: redisResult(command) }))), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function buildHarness() {
  const networkCalls = [];
  const nativeFetch = async (input, init = {}) => {
    const body = JSON.parse(String(init.body || "[]"));
    networkCalls.push({ url: String(input), body });
    if (String(input).endsWith("/pipeline")) return pipelineResponse(body);
    return redisResponse(redisResult(body));
  };

  const rateLimitFetch = createRedisRateLimitFetch(nativeFetch, REDIS_URL);
  const fetch = createRedisRateReadFetch(rateLimitFetch, REDIS_URL);
  return { fetch, networkCalls };
}

async function command(fetch, value) {
  const response = await fetch(REDIS_URL, {
    method: "POST",
    body: JSON.stringify(value)
  });
  assert.equal(response.ok, true);
  await response.json();
}

async function rateAndRead(fetch, action, key = OWNER_KEY) {
  const rateKey = `maviri:tenant:${TENANT}:rate:${action}:${HASH}`;
  await command(fetch, ["INCR", rateKey]);
  const windows = {
    chat: 60,
    availability: 60,
    book: 300,
    update: 300,
    cancel: 300,
    context: 60,
    "public-context": 60
  };
  await command(fetch, ["EXPIRE", rateKey, String(windows[action])]);
  await command(fetch, ["GET", key]);
}

async function pairedWrite(fetch, releaseToken = "") {
  await command(fetch, ["SET", OWNER_KEY, "{\"revision\":2}"]);
  await command(fetch, ["SET", PUBLIC_KEY, "{\"revision\":2}"]);
  if (releaseToken) {
    await command(fetch, [
      "EVAL",
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      "1",
      LOCK_KEY,
      releaseToken
    ]);
  }
}

async function measure(run) {
  const { fetch, networkCalls } = buildHarness();
  await runWithRedisOptimizationContext(() =>
    runWithRedisRateReadContext(() => run(fetch))
  );
  return networkCalls;
}

const readBudgets = [
  ["chat", OWNER_KEY],
  ["availability", OWNER_KEY],
  ["context", PUBLIC_KEY],
  ["public-context", PUBLIC_KEY]
];

for (const [action, key] of readBudgets) {
  test(`${action}: massimo 1 round-trip Redis`, async () => {
    const calls = await measure(fetch => rateAndRead(fetch, action, key));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${REDIS_URL}/pipeline`);
    assert.equal(calls[0].body.length, 2);
    assert.deepEqual(calls[0].body[1], ["GET", key]);
  });
}

test("cancel cliente: massimo 2 round-trip Redis", async () => {
  const calls = await measure(async fetch => {
    await rateAndRead(fetch, "cancel");
    await pairedWrite(fetch);
  });
  assert.equal(calls.length, 2);
  assert.equal(calls.filter(call => call.url.endsWith("/pipeline")).length, 2);
});

for (const action of ["owner-sync", "confirm-attendance"]) {
  test(`${action}: massimo 2 round-trip Redis`, async () => {
    const calls = await measure(async fetch => {
      await command(fetch, ["GET", OWNER_KEY]);
      await pairedWrite(fetch);
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, REDIS_URL);
    assert.equal(calls[1].url, `${REDIS_URL}/pipeline`);
  });
}

for (const action of ["book", "update"]) {
  test(`${action}: massimo 3 round-trip Redis con lock distribuito`, async () => {
    const token = `${action}-token`;
    const calls = await measure(async fetch => {
      await rateAndRead(fetch, action);
      await command(fetch, ["SET", LOCK_KEY, token, "NX", "PX", "15000"]);
      if (action === "book") await command(fetch, ["GET", OWNER_KEY]);
      await pairedWrite(fetch, token);
    });

    assert.equal(calls.length, 3);
    assert.equal(calls.every(call => call.url.endsWith("/pipeline")), true);
    assert.equal(calls[1].body[0][0], "SET");
    assert.equal(calls[1].body[1][0], "GET");
    assert.equal(calls[2].body.length, 3);
    assert.equal(calls[2].body[2][0], "EVAL");
  });
}
