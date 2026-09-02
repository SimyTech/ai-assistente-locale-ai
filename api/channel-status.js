import { readinessChecks } from "../lib/launch-readiness.js";

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Metodo non consentito." });
  }

  const checks = readinessChecks(process.env);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(200).json({
    ok: true,
    channels: {
      whatsapp: { ready: Boolean(checks.whatsapp.ready) },
      email: { ready: Boolean(checks.email.ready), provider: checks.email.provider }
    },
    timestamp: new Date().toISOString()
  });
}
