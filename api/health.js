export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Metodo non consentito." });
  }

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const redis = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
  const sessions = Boolean(process.env.MAVIRI_SESSION_SECRET);
  const registration = redis && sessions;
  const legacyOwnerSync = Boolean(process.env.MAVIRI_OWNER_SYNC_TOKEN || process.env.MAVIRI_OWNER_TOKENS);
  const whatsappBridge = Boolean(
    process.env.WHATSAPP_VERIFY_TOKEN &&
    process.env.WHATSAPP_ACCESS_TOKEN &&
    process.env.WHATSAPP_PHONE_NUMBER_ID
  );
  const whatsappSignature = Boolean(process.env.WHATSAPP_APP_SECRET);
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
      whatsappSignature
    },
    timestamp: new Date().toISOString()
  });
}
