import { getRedisOptimizationMetrics } from "./redis-rate-limit-optimizer.js";

function actionName(req = {}) {
  const value = String(req?.body?.action || "operation").trim().toLowerCase();
  return /^[a-z0-9-]{1,40}$/.test(value) ? value : "operation";
}

function safeSetHeader(res, name, value) {
  try {
    if (!res?.headersSent && typeof res?.setHeader === "function") {
      res.setHeader(name, String(value));
    }
  } catch {
    // Le metriche non devono mai interferire con la risposta applicativa.
  }
}

export function attachOperationalMetrics(req, res, callback) {
  const started = performance.now();
  const originalEnd = typeof res?.end === "function" ? res.end : null;
  let finalized = false;

  const finalize = () => {
    if (finalized) return;
    finalized = true;

    const elapsed = Math.max(0, performance.now() - started);
    const metrics = getRedisOptimizationMetrics();
    safeSetHeader(res, "X-Maviri-Operation", actionName(req));
    safeSetHeader(res, "X-Maviri-Server-Ms", elapsed.toFixed(1));
    safeSetHeader(res, "X-Maviri-Redis-Calls", metrics.redisCalls);
    safeSetHeader(res, "X-Maviri-Redis-Pipelines", metrics.redisPipelines);
    safeSetHeader(res, "X-Maviri-Redis-Synthetic", metrics.syntheticResponses);
    safeSetHeader(
      res,
      "Server-Timing",
      `maviri;dur=${elapsed.toFixed(1)}, redis;desc=\"${metrics.redisCalls} calls/${metrics.redisPipelines} pipelines\"`
    );
  };

  if (originalEnd) {
    res.end = function maviriMetricsEnd(...args) {
      finalize();
      return originalEnd.apply(this, args);
    };
  }

  try {
    const result = callback();
    if (result && typeof result.then === "function") {
      return result.finally(() => {
        if (!res?.writableEnded) finalize();
      });
    }
    if (!res?.writableEnded) finalize();
    return result;
  } catch (error) {
    finalize();
    throw error;
  }
}
