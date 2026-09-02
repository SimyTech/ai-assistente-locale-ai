const clean = value => String(value ?? "").trim();

export function readinessChecks(env = process.env) {
  const redis = Boolean(clean(env.UPSTASH_REDIS_REST_URL) && clean(env.UPSTASH_REDIS_REST_TOKEN));
  const sessions = Boolean(clean(env.MAVIRI_SESSION_SECRET));
  const reminderAuth = Boolean(clean(env.CRON_SECRET) || clean(env.MAVIRI_REMINDER_SECRET));
  const whatsappVerify = Boolean(clean(env.WHATSAPP_VERIFY_TOKEN));
  const whatsappSend = Boolean(clean(env.WHATSAPP_ACCESS_TOKEN) && clean(env.WHATSAPP_PHONE_NUMBER_ID));
  const whatsappSignature = Boolean(clean(env.WHATSAPP_APP_SECRET));
  const emailProvider = clean(env.EMAIL_PROVIDER || "log").toLowerCase();
  const emailConfigured = emailProvider === "resend"
    ? Boolean(clean(env.RESEND_API_KEY) && clean(env.EMAIL_FROM))
    : emailProvider === "webhook"
      ? Boolean(clean(env.EMAIL_WEBHOOK_URL))
      : false;

  return {
    core: { redis, sessions, ready: redis && sessions },
    reminders: { engine: true, auth: reminderAuth, ready: redis && reminderAuth },
    whatsapp: {
      verify: whatsappVerify,
      send: whatsappSend,
      signature: whatsappSignature,
      ready: whatsappVerify && whatsappSend && whatsappSignature
    },
    email: { provider: emailProvider, configured: emailConfigured, ready: emailConfigured }
  };
}

export function launchReadiness(env = process.env) {
  const checks = readinessChecks(env);
  const blockers = [];
  if (!checks.core.redis) blockers.push("redis");
  if (!checks.core.sessions) blockers.push("session-secret");
  if (!checks.reminders.auth) blockers.push("reminder-secret");
  if (!checks.whatsapp.verify) blockers.push("whatsapp-verify-token");
  if (!checks.whatsapp.send) blockers.push("whatsapp-send-credentials");
  if (!checks.whatsapp.signature) blockers.push("whatsapp-app-secret");
  if (!checks.email.ready) blockers.push("transactional-email");

  const coreReady = checks.core.ready;
  const integrationsReady = checks.reminders.ready && checks.whatsapp.ready && checks.email.ready;
  return {
    ready: coreReady && integrationsReady,
    coreReady,
    integrationsReady,
    blockers,
    checks
  };
}
