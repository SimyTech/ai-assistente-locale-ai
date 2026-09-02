import { launchReadiness } from "../lib/launch-readiness.js";

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Metodo non consentito." });
  }

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const result = launchReadiness(process.env);
  return res.status(result.ready ? 200 : 503).json({
    ok: result.ready,
    service: "maviri",
    version: "0.2.0",
    ...result,
    timestamp: new Date().toISOString()
  });
}
