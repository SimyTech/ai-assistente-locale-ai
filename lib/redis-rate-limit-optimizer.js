import { rateLimitPolicy } from "./rate-limit.js";

const INSTALL_MARK = Symbol.for("maviri.redis-rate-limit-optimizer");

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

function syntheticRedisResponse(result) {
  return new Response(JSON.stringify({ result }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
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
