import { installRedisRateLimitOptimizer } from "./redis-rate-limit-optimizer.js";

export async function loadBusinessEngine() {
  installRedisRateLimitOptimizer();
  const module = await import("../api/chat.js");
  return module.default;
}

export async function loadConversationalProxy() {
  const module = await import("../api/chat-proxy.js");
  return module.default;
}

export async function loadOperationalChatBuilder() {
  const module = await import("./operational-chat.js");
  return module.buildOperationalChatResponse;
}
