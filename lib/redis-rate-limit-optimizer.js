import { AsyncLocalStorage } from "node:async_hooks";
import { rateLimitPolicy } from "./rate-limit.js";

const INSTALL_MARK = Symbol.for("maviri.redis-rate-limit-optimizer");
const redisRequestContext = new AsyncLocalStorage();

const RATE_LIMIT_SCRIPT =
  "local count = redis.call('incr', KEYS[1]); if count == 1 then redis.call('expire', KEYS[1], ARGV[1]); end; return count";
const RELEASE_LOCK_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
const OWNER_PREFETCH_ACTIONS = new Set(["book", "update", "cancel", "client"]);

function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return String(input?.url || "");
}

function parseCommand(init = {}) {
  if (String(init?.method || "GET").toUpperCase() !== "POST") return null;
  if (typeof init?.body !== "string") return null;

  try {
    const command = JSON.parse(init.body);
    return Array.isArray(command) ? command : null;
  } catch {
    return null;
  }
}

function rateActionFromKey(key) {
  const match = String(key || "").match(
    /^maviri:tenant:[^:]+:rate:([^:]+):[a-f0-9]{8,}$/i
  );
  return match?.[1] || "";
}

function ownerDataKeyFromRateKey(key) {
  const match = String(key || "").match(
    /^maviri:tenant:([^:]+):rate:[^:]+:[a-f0-9]{8,}$/i
  );
  if (!match) return "";
  return match[1] === "default"
    ? "maviri:owner-data"
    : `maviri:tenant:${match[1]}:owner-data`;
}

function isOwnerDataKey(key) {
  const value = String(key || "");
  return value === "maviri:owner-data" ||
    /^maviri:tenant:[^:]+:owner-data$/i.test(value);
}

function matchingOwnerDataKey(publicKey) {
  const value = String(publicKey || "");
  if (value === "maviri:public-context") return "maviri:owner-data";

  const match = value.match(/^maviri:tenant:([^:]+):public-context$/i);
  return match ? `maviri:tenant:${match[1]}:owner-data` : "";
}

function ownerDataKeyFromBookingLock(lockKey) {
  const value = String(lockKey || "");
  if (value.startsWith("maviri:booking-lock:")) {
    return "maviri:owner-data";
  }

  const match = value.match(/^maviri:tenant:([^:]+):booking-lock:/i);
  return match ? `maviri:tenant:${match[1]}:owner-data` : "";
}

function isBookingLockSet(command) {
  if (!Array.isArray(command) || String(command[0] || "").toUpperCase() !== "SET") {
    return false;
  }

  const ownerKey = ownerDataKeyFromBookingLock(command[1]);
  if (!ownerKey) return false;

  const args = command.slice(3).map(value => String(value).toUpperCase());
  return args.includes("NX") && args.includes("PX");
}

function isMatchingLockRelease(command, lock) {
  if (!lock || !Array.isArray(command)) return false;
  if (String(command[0] || "").toUpperCase() !== "EVAL") return false;
  return String(command[2] || "") === "1" &&
    String(command[3] || "") === lock.key &&
    String(command[4] || "") === lock.token;
}

function syntheticRedisResponse(result) {
  return new Response(JSON.stringify({ result }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function syntheticRedisError(error) {
  return new Response(JSON.stringify({ error: String(error || "Redis pipeline error") }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function pipelineUrl(redisUrl) {
  return `${String(redisUrl || "").replace(/\/+$/, "")}/pipeline`;
}

function newMetrics() {
  return {
    redisCalls: 0,
    redisPipelines: 0,
    syntheticResponses: 0
  };
}

function markSynthetic(store) {
  if (store?.metrics) store.metrics.syntheticResponses += 1;
}

export function getRedisOptimizationMetrics() {
  const metrics = redisRequestContext.getStore()?.metrics;
  return metrics ? { ...metrics } : newMetrics();
}

export function runWithRedisOptimizationContext(callback) {
  return redisRequestContext.run({
    pendingOwnerWrite: null,
    prefetchedOwnerRead: null,
    activeBookingLock: null,
    releasedBookingLock: null,
    metrics: newMetrics()
  }, callback);
}

export function createRedisRateLimitFetch(originalFetch, redisUrl) {
  if (typeof originalFetch !== "function") {
    throw new TypeError("Fetch originale non disponibile.");
  }

  const targetUrl = String(redisUrl || "").trim();
  const targetPipelineUrl = pipelineUrl(targetUrl);

  async function redisNetworkFetch(input, init, store) {
    if (store?.metrics) {
      store.metrics.redisCalls += 1;
      if (requestUrl(input) === targetPipelineUrl) {
        store.metrics.redisPipelines += 1;
      }
    }
    return originalFetch(input, init);
  }

  return async function maviriRedisFetch(input, init = {}) {
    if (!targetUrl || requestUrl(input) !== targetUrl) {
      return originalFetch(input, init);
    }

    const command = parseCommand(init);
    if (!command) return originalFetch(input, init);

    const operation = String(command[0] || "").toUpperCase();
    const key = String(command[1] || "");
    const action = rateActionFromKey(key);
    const policy = action ? rateLimitPolicy(action) : null;
    const store = redisRequestContext.getStore();

    if (operation === "INCR" && policy) {
      const rateCommand = [
        "EVAL",
        RATE_LIMIT_SCRIPT,
        "1",
        key,
        String(policy.windowSeconds)
      ];
      const ownerDataKey = store && OWNER_PREFETCH_ACTIONS.has(action)
        ? ownerDataKeyFromRateKey(key)
        : "";

      if (ownerDataKey) {
        const pipelineResponse = await redisNetworkFetch(targetPipelineUrl, {
          ...init,
          method: "POST",
          body: JSON.stringify([
            rateCommand,
            ["GET", ownerDataKey]
          ])
        }, store);

        if (!pipelineResponse.ok) return pipelineResponse;

        const pipelineResult = await pipelineResponse.json();
        if (!Array.isArray(pipelineResult) || pipelineResult.length < 2) {
          return syntheticRedisError("Risposta pipeline Redis non valida.");
        }

        const rateResult = pipelineResult[0] || {};
        const readResult = pipelineResult[1] || {};
        if (rateResult.error) {
          return syntheticRedisError(rateResult.error);
        }

        store.prefetchedOwnerRead = {
          key: ownerDataKey,
          result: readResult.result,
          error: readResult.error || null
        };
        markSynthetic(store);
        return syntheticRedisResponse(rateResult.result);
      }

      return redisNetworkFetch(input, {
        ...init,
        body: JSON.stringify(rateCommand)
      }, store);
    }

    if (
      operation === "EXPIRE" &&
      policy &&
      Number(command[2]) === Number(policy.windowSeconds)
    ) {
      markSynthetic(store);
      return syntheticRedisResponse(1);
    }

    if (
      store &&
      store.releasedBookingLock &&
      isMatchingLockRelease(command, store.releasedBookingLock)
    ) {
      store.releasedBookingLock = null;
      markSynthetic(store);
      return syntheticRedisResponse(1);
    }

    if (store && operation === "SET" && isBookingLockSet(command)) {
      const ownerDataKey = ownerDataKeyFromBookingLock(key);
      const pipelineResponse = await redisNetworkFetch(targetPipelineUrl, {
        ...init,
        method: "POST",
        body: JSON.stringify([
          command,
          ["GET", ownerDataKey]
        ])
      }, store);

      if (!pipelineResponse.ok) return pipelineResponse;

      const pipelineResult = await pipelineResponse.json();
      if (!Array.isArray(pipelineResult) || pipelineResult.length < 2) {
        return syntheticRedisError("Risposta pipeline Redis non valida.");
      }

      const lockResult = pipelineResult[0] || {};
      const readResult = pipelineResult[1] || {};

      if (lockResult.error) {
        return syntheticRedisError(lockResult.error);
      }

      if (String(lockResult.result || "").toUpperCase() === "OK") {
        store.activeBookingLock = {
          key,
          token: String(command[2] || "")
        };
        store.prefetchedOwnerRead = {
          key: ownerDataKey,
          result: readResult.result,
          error: readResult.error || null
        };
      } else {
        store.activeBookingLock = null;
        store.prefetchedOwnerRead = null;
      }

      markSynthetic(store);
      return syntheticRedisResponse(lockResult.result);
    }

    if (
      store &&
      operation === "GET" &&
      store.prefetchedOwnerRead &&
      store.prefetchedOwnerRead.key === key
    ) {
      const prefetched = store.prefetchedOwnerRead;
      store.prefetchedOwnerRead = null;

      if (prefetched.error) {
        return syntheticRedisError(prefetched.error);
      }

      markSynthetic(store);
      return syntheticRedisResponse(prefetched.result);
    }

    if (store && operation === "SET" && isOwnerDataKey(key)) {
      store.pendingOwnerWrite = { command, init };
      markSynthetic(store);
      return syntheticRedisResponse("OK");
    }

    if (store && operation === "SET" && store.pendingOwnerWrite) {
      const ownerCommand = store.pendingOwnerWrite.command;
      const expectedOwnerKey = matchingOwnerDataKey(key);

      if (expectedOwnerKey && String(ownerCommand[1]) === expectedOwnerKey) {
        store.pendingOwnerWrite = null;

        const commands = [ownerCommand, command];
        const lock = store.activeBookingLock;
        if (lock) {
          commands.push([
            "EVAL",
            RELEASE_LOCK_SCRIPT,
            "1",
            lock.key,
            lock.token
          ]);
        }

        const pipelineResponse = await redisNetworkFetch(targetPipelineUrl, {
          ...init,
          method: "POST",
          body: JSON.stringify(commands)
        }, store);

        if (!pipelineResponse.ok) return pipelineResponse;

        const pipelineResult = await pipelineResponse.json();
        if (!Array.isArray(pipelineResult) || pipelineResult.length < commands.length) {
          return syntheticRedisError("Risposta pipeline Redis non valida.");
        }

        const first = pipelineResult[0] || {};
        const second = pipelineResult[1] || {};
        const release = lock ? (pipelineResult[2] || {}) : null;
        if (first.error || second.error || release?.error) {
          return syntheticRedisError(first.error || second.error || release?.error);
        }

        if (lock) {
          store.releasedBookingLock = lock;
          store.activeBookingLock = null;
        }

        markSynthetic(store);
        return syntheticRedisResponse(second.result);
      }
    }

    return redisNetworkFetch(input, init, store);
  };
}

export function installRedisRateLimitOptimizer() {
  if (globalThis[INSTALL_MARK]) return false;

  const redisUrl = String(process.env.UPSTASH_REDIS_REST_URL || "").trim();
  if (!redisUrl || typeof globalThis.fetch !== "function") return false;

  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = createRedisRateLimitFetch(originalFetch, redisUrl);
  globalThis[INSTALL_MARK] = true;
  return true;
}
