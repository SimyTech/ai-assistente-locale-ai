import { launchReadiness, readinessChecks } from "../lib/launch-readiness.js";
import reminderHandler from "../lib/reminders-handler.js";

export default function handler(req, res) {
  const mode = String(req?.query?.mode || "").trim().toLowerCase();
  if (mode === "reminders") return reminderHandler(req, res);

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Metodo non consentito." });
  }

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

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

  const checks = readinessChecks(process.env);
  const redis = checks.core.redis;
  const sessions = checks.core.sessions;
  const registration = redis && sessions;
  const legacyOwnerSync = Boolean(process.env.MAVIRI_OWNER_SYNC_TOKEN || process.env.MAVIRI_OWNER_TOKENS);
  const whatsappBridge = checks.whatsapp.verify && checks.whatsapp.send;
  const whatsappSignature = checks.whatsapp.signature;
  const ready = redis && sessions;

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
