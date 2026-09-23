const REDIS_HEALTH_TIMEOUT_MS = Number(process.env.MAVIRI_REDIS_HEALTH_TIMEOUT_MS || 2500);

export async function checkRedisConnection(env = process.env) {
  const url = String(env.UPSTASH_REDIS_REST_URL || "");
  const token = String(env.UPSTASH_REDIS_REST_TOKEN || "");

  if (!url || !token) return { ok: false, reason: "not-configured" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REDIS_HEALTH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(["PING"]),
      signal: controller.signal
    });

    if (!response.ok) return { ok: false, reason: "unreachable" };

    const payload = await response.json();
    return { ok: !payload?.error && String(payload?.result || "").toUpperCase() === "PONG", reason: "ok" };
  } catch (error) {
    return { ok: false, reason: error?.name === "AbortError" ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timeout);
  }
}
