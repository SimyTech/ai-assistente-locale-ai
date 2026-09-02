import {
  installRedisRateLimitOptimizer,
  runWithRedisOptimizationContext
} from "./redis-rate-limit-optimizer.js";

export async function loadBusinessEngine() {
  installRedisRateLimitOptimizer();
  const module = await import("../api/chat.js");
  const handler = module.default;

  return function optimizedBusinessEngine(req, res) {
    return runWithRedisOptimizationContext(() => handler(req, res));
  };
}

export async function loadConversationalProxy() {
  const module = await import("../api/chat-proxy.js");
  return module.default;
}

export async function loadOperationalChatBuilder() {
  const module = await import("./operational-chat.js");
  return module.buildOperationalChatResponse;
}
