import { AsyncLocalStorage } from "node:async_hooks";
import { rateLimitPolicy } from "./rate-limit.js";

const INSTALL_MARK = Symbol.for("maviri.redis-rate-read-optimizer");
const requestContext = new AsyncLocalStorage();
const OWNER_DATA_ACTIONS = new Set(["availability", "book", "update", "cancel", "chat"]);
const PUBLIC_DATA_ACTIONS = new Set(["context", "public-context"]);
const RATE_LIMIT_SCRIPT =
  "local count = redis.call('incr', KEYS[1]); if count == 1 then redis.call('expire', KEYS[1], ARGV[1]); end; return count";

function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return String(input?.url || "");
}

function parseCommand(init = {}) {
  if (String(init?.method || "GET").toUpperCase() !== "POST") return null;
  if (typeof init?.body !== "string") return null;
  try {
    const value = JSON.parse(init.body);
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function rateInfo(key) {
  const match = String(key || "").match(
    /^maviri:tenant:([^:]+):rate:([^:]+):[a-f0-9]{8,}$/i
  );
  if (!match) return null;

  return {
    tenant: match[1].toLowerCase(),
    action: match[2].toLowerCase()
  };
}

function ownerDataKey(tenant) {
  return tenant === "default"
    ? "maviri:owner-data"
    : `maviri:tenant:${tenant}:owner-data`;
}

function publicDataKey(tenant) {
  return tenant === "default"
    ? "maviri:public-context"
    : `maviri:tenant:${tenant}:public-context`;
}

function readKeyForAction(info) {
  if (!info) return "";
  if (OWNER_DATA_ACTIONS.has(info.action)) return ownerDataKey(info.tenant);
  if (PUBLIC_DATA_ACTIONS.has(info.action)) return publicDataKey(info.tenant);
  return "";
}

function pipelineUrl(redisUrl) {
  return `${String(redisUrl || "").replace(/\/+$/, "")}/pipeline`;
}

function response(result) {
  return new Response(JSON.stringify({ result }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function errorResponse(error) {
  return new Response(JSON.stringify({ error: String(error || "Redis pipeline error") }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function emptyMetrics() {
  return { redisCalls: 0, redisPipelines: 0, syntheticResponses: 0 };
}

export function getRedisRateReadMetrics() {
  const metrics = requestContext.getStore()?.metrics;
  return metrics ? { ...metrics } : emptyMetrics();
}

export function runWithRedisRateReadContext(callback) {
  return requestContext.run({ prefetched: null, metrics: emptyMetrics() }, callback);
}

export function createRedisRateReadFetch(originalFetch, redisUrl) {
  if (typeof originalFetch !== "function") {
    throw new TypeError("Fetch originale non disponibile.");
  }

  const targetUrl = String(redisUrl || "").trim();
  const targetPipelineUrl = pipelineUrl(targetUrl);

  return async function redisRateReadFetch(input, init = {}) {
    if (!targetUrl || requestUrl(input) !== targetUrl) {
      return originalFetch(input, init);
    }

    const command = parseCommand(init);
    if (!command) return originalFetch(input, init);

    const store = requestContext.getStore();
    if (!store) return originalFetch(input, init);

    const operation = String(command[0] || "").toUpperCase();
    const key = String(command[1] || "");

    if (operation === "INCR") {
      const info = rateInfo(key);
      const policy = info ? rateLimitPolicy(info.action) : null;
      const dataKey = policy ? readKeyForAction(info) : "";

      if (info && policy && dataKey) {
        store.metrics.redisCalls += 1;
        store.metrics.redisPipelines += 1;

        const result = await originalFetch(targetPipelineUrl, {
          ...init,
          method: "POST",
          body: JSON.stringify([
            ["EVAL", RATE_LIMIT_SCRIPT, "1", key, String(policy.windowSeconds)],
            ["GET", dataKey]
          ])
        });

        if (!result.ok) return result;
        const body = await result.json();
        if (!Array.isArray(body) || body.length < 2) {
          return errorResponse("Risposta pipeline Redis non valida.");
        }

        const rate = body[0] || {};
        const read = body[1] || {};
        if (rate.error) return errorResponse(rate.error);

        store.prefetched = {
          key: dataKey,
          result: read.result,
          error: read.error || null
        };
        store.metrics.syntheticResponses += 1;
        return response(rate.result);
      }
    }

    if (
      operation === "GET" &&
      store.prefetched &&
      store.prefetched.key === key
    ) {
      const prefetched = store.prefetched;
      store.prefetched = null;
      store.metrics.syntheticResponses += 1;
      if (prefetched.error) return errorResponse(prefetched.error);
      return response(prefetched.result);
    }

    return originalFetch(input, init);
  };
}

export function installRedisRateReadOptimizer() {
  if (globalThis[INSTALL_MARK]) return false;

  const redisUrl = String(process.env.UPSTASH_REDIS_REST_URL || "").trim();
  if (!redisUrl || typeof globalThis.fetch !== "function") return false;

  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = createRedisRateReadFetch(originalFetch, redisUrl);
  globalThis[INSTALL_MARK] = true;
  return true;
}
