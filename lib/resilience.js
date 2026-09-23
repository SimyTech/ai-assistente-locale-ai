import { randomUUID } from "node:crypto";

const SLOW_REQUEST_MS = Number(process.env.MAVIRI_SLOW_REQUEST_MS || 1200);

export function observeRequest(req, res, route) {
  const startedAt = Date.now();
  const requestId = randomUUID();

  res.setHeader("X-Request-Id", requestId);

  if (typeof res?.on !== "function") {
    return requestId;
  }

  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    const status = Number(res.statusCode || 0);
    if (status >= 500 || durationMs >= SLOW_REQUEST_MS) {
      console[status >= 500 ? "error" : "warn"](JSON.stringify({
        event: "maviri.request",
        level: status >= 500 ? "error" : "warn",
        route,
        method: req.method || "UNKNOWN",
        status,
        durationMs,
        requestId
      }));
    }
  });

  return requestId;
}

export function logServiceFailure({ route, requestId, error }) {
  console.error(JSON.stringify({
    event: "maviri.service_failure",
    route,
    requestId,
    name: String(error?.name || "Error").slice(0, 120),
    message: String(error?.message || "Errore interno").slice(0, 300)
  }));
}
