import { whatsappOutboundTenantMap } from "./reminder-dispatch.js";
import { whatsappTenantMap } from "./whatsapp-tenant.js";

const clean = value => String(value ?? "").trim();

export function readinessChecks(env = process.env) {
  const redis = Boolean(clean(env.UPSTASH_REDIS_REST_URL) && clean(env.UPSTASH_REDIS_REST_TOKEN));
  const sessions = Boolean(clean(env.MAVIRI_SESSION_SECRET));
  const reminderAuth = Boolean(clean(env.CRON_SECRET) || clean(env.MAVIRI_REMINDER_SECRET));
  const whatsappVerify = Boolean(clean(env.WHATSAPP_VERIFY_TOKEN));
  const whatsappRoutes = whatsappTenantMap(env);
  const whatsappOutboundRoutes = whatsappOutboundTenantMap(env);
  const whatsappSend = Boolean(
    clean(env.WHATSAPP_ACCESS_TOKEN) &&
    (clean(env.WHATSAPP_PHONE_NUMBER_ID) || Object.keys(whatsappOutboundRoutes).length)
  );
  const whatsappSignature = Boolean(clean(env.WHATSAPP_APP_SECRET));

  // Keep launch readiness aligned with the email transport actually used by
  // account recovery and email verification. A partial Resend setup must not
  // be reported as production-ready.
  const emailProvider = "resend";
  const emailConfigured = Boolean(
    clean(env.RESEND_API_KEY) &&
    clean(env.MAVIRI_EMAIL_FROM) &&
    clean(env.MAVIRI_PUBLIC_URL)
  );

  return {
    core: { redis, sessions, ready: redis && sessions },
    reminders: { engine: true, auth: reminderAuth, ready: redis && reminderAuth },
    whatsapp: {
      verify: whatsappVerify,
      send: whatsappSend,
      signature: whatsappSignature,
      routedTenants: Object.keys(whatsappRoutes).length,
      outboundRoutes: Object.keys(whatsappOutboundRoutes).length,
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
