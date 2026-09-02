import { AsyncLocalStorage } from "node:async_hooks";
import { rateLimitPolicy } from "./rate-limit.js";

const INSTALL_MARK = Symbol.for("maviri.redis-rate-limit-optimizer");
const redisRequestContext = new AsyncLocalStorage();

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

export function runWithRedisOptimizationContext(callback) {
  return redisRequestContext.run({
    pendingOwnerWrite: null,
    prefetchedOwnerRead: null
  }, callback);
}

export function createRedisRateLimitFetch(originalFetch, redisUrl) {
  if (typeof originalFetch !== "function") {
    throw new TypeError("Fetch originale non disponibile.");
  }

  const targetUrl = String(redisUrl || "").trim();

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

    if (operation === "INCR" && policy) {
      return originalFetch(input, {
        ...init,
        body: JSON.stringify([
          "EVAL",
          RATE_LIMIT_SCRIPT,
          "1",
          key,
          String(policy.windowSeconds)
        ])
      });
    }

    if (
      operation === "EXPIRE" &&
      policy &&
      Number(command[2]) === Number(policy.windowSeconds)
    ) {
      // L'EXPIRE è già stato eseguito atomicamente insieme all'INCR.
      return syntheticRedisResponse(1);
    }

    const store = redisRequestContext.getStore();

    if (store && operation === "SET" && isBookingLockSet(command)) {
      const ownerDataKey = ownerDataKeyFromBookingLock(key);
      const pipelineResponse = await originalFetch(pipelineUrl(targetUrl), {
        ...init,
        method: "POST",
        body: JSON.stringify([
          command,
          ["GET", ownerDataKey]
        ])
      });

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
        store.prefetchedOwnerRead = {
          key: ownerDataKey,
          result: readResult.result,
          error: readResult.error || null
        };
      } else {
        store.prefetchedOwnerRead = null;
      }

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

      return syntheticRedisResponse(prefetched.result);
    }

    if (store && operation === "SET" && isOwnerDataKey(key)) {
      // Il Business Engine scrive subito dopo il public-context dello stesso tenant.
      // Manteniamo la prima SET nel contesto della singola richiesta e la inviamo
      // insieme alla seconda con una sola chiamata HTTP a Upstash.
      store.pendingOwnerWrite = { command, init };
      return syntheticRedisResponse("OK");
    }

    if (store && operation === "SET" && store.pendingOwnerWrite) {
      const ownerCommand = store.pendingOwnerWrite.command;
      const expectedOwnerKey = matchingOwnerDataKey(key);

      if (expectedOwnerKey && String(ownerCommand[1]) === expectedOwnerKey) {
        store.pendingOwnerWrite = null;

        const pipelineResponse = await originalFetch(pipelineUrl(targetUrl), {
          ...init,
          method: "POST",
          body: JSON.stringify([ownerCommand, command])
        });

        if (!pipelineResponse.ok) return pipelineResponse;

        const pipelineResult = await pipelineResponse.json();
        if (!Array.isArray(pipelineResult) || pipelineResult.length < 2) {
          return syntheticRedisError("Risposta pipeline Redis non valida.");
        }

        const first = pipelineResult[0] || {};
        const second = pipelineResult[1] || {};
        if (first.error || second.error) {
          return syntheticRedisError(first.error || second.error);
        }

        return syntheticRedisResponse(second.result);
      }
    }

    return originalFetch(input, init);
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
