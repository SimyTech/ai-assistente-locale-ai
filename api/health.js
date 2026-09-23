import { launchReadiness, readinessChecks } from "../lib/launch-readiness.js";
import reminderHandler from "../lib/reminders-handler.js";
import maviQrHandler from "../lib/mavi-qr-handler.js";
import { observeRequest } from "../lib/resilience.js";
import { checkRedisConnection } from "../lib/runtime-health.js";

async function deepHealth(req, res, checks) {
  const redisProbe = checks.core.redis
    ? await checkRedisConnection(process.env)
    : { ok: false, reason: "not-configured" };
  const redis = Boolean(checks.core.redis && redisProbe.ok);
  const sessions = checks.core.sessions;

  return res.status(redis && sessions ? 200 : 503).json({
    ok: redis && sessions,
    ready: redis && sessions,
    service: "maviri",
    version: "0.2.0",
    checks: {
      redis,
      redisConfigured: Boolean(checks.core.redis),
      redisReason: redisProbe.reason,
      sessions,
      registration: redis && sessions
    },
    timestamp: new Date().toISOString()
  });
}

export default function handler(req, res) {
  const mode = String(req?.query?.mode || "").trim().toLowerCase();
  if (mode === "reminders") return reminderHandler(req, res);
  if (mode === "mavi-qr") return maviQrHandler(req, res);

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Metodo non consentito." });
  }

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  observeRequest(req, res, "/api/health");

  const checks = readinessChecks(process.env);

  if (mode === "deep") {
    return deepHealth(req, res, checks);
  }

  if (mode === "readiness") {
    const result = launchReadiness(process.env);
    return res.status(result.ready ? 200 : 503).json({
      ok: result.ready,
      service: "maviri",
      version: "0.2.0",
      ...result,
      timestamp: new Date().toISOString()
    });
  }

  const redis = checks.core.redis;
  const sessions = checks.core.sessions;
  const registration = redis && sessions;
  const legacyOwnerSync = Boolean(process.env.MAVIRI_OWNER_SYNC_TOKEN || process.env.MAVIRI_OWNER_TOKENS);
  const whatsappBridge = checks.whatsapp.verify && checks.whatsapp.send;
  const whatsappSignature = checks.whatsapp.signature;
  const ready = redis && sessions;

  if (mode === "channels") {
    return res.status(200).json({
      ok: true,
      channels: {
        whatsapp: { ready: Boolean(checks.whatsapp.ready) },
        email: { ready: Boolean(checks.email.ready), provider: checks.email.provider }
      },
      timestamp: new Date().toISOString()
    });
  }

  return res.status(ready ? 200 : 503).json({
    ok: ready,
    ready,
    service: "maviri",
    version: "0.2.0",
    checks: {
      redis,
      sessions,
      registration,
      legacyOwnerSync,
      whatsappBridge,
      whatsappSignature,
      whatsappRoutedTenants: checks.whatsapp.routedTenants
    },
    timestamp: new Date().toISOString()
  });
}
