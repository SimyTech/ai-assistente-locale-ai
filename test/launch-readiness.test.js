import test from "node:test";
import assert from "node:assert/strict";

import { launchReadiness, readinessChecks } from "../lib/launch-readiness.js";

test("core readiness richiede Redis e session secret", () => {
  const checks = readinessChecks({
    UPSTASH_REDIS_REST_URL: "https://redis.example",
    UPSTASH_REDIS_REST_TOKEN: "token",
    MAVIRI_SESSION_SECRET: "secret"
  });
  assert.equal(checks.core.ready, true);
});

test("readiness completo segnala integrazioni mancanti senza esporre segreti", () => {
  const result = launchReadiness({
    UPSTASH_REDIS_REST_URL: "https://redis.example",
    UPSTASH_REDIS_REST_TOKEN: "token",
    MAVIRI_SESSION_SECRET: "session-secret",
    WHATSAPP_VERIFY_TOKEN: "verify"
  });
  assert.equal(result.ready, false);
  assert.equal(result.coreReady, true);
  assert.ok(result.blockers.includes("reminder-secret"));
  assert.ok(result.blockers.includes("whatsapp-send-credentials"));
  assert.ok(result.blockers.includes("whatsapp-app-secret"));
  assert.ok(result.blockers.includes("transactional-email"));
  assert.doesNotMatch(JSON.stringify(result), /session-secret|https:\/\/redis\.example/);
});

test("readiness è completa quando tutte le dipendenze di lancio sono configurate", () => {
  const result = launchReadiness({
    UPSTASH_REDIS_REST_URL: "https://redis.example",
    UPSTASH_REDIS_REST_TOKEN: "redis-token",
    MAVIRI_SESSION_SECRET: "session-secret",
    CRON_SECRET: "cron-secret",
    WHATSAPP_VERIFY_TOKEN: "verify-token",
    WHATSAPP_ACCESS_TOKEN: "wa-token",
    WHATSAPP_PHONE_NUMBER_ID: "123",
    WHATSAPP_APP_SECRET: "app-secret",
    RESEND_API_KEY: "resend-key",
    MAVIRI_EMAIL_FROM: "Maviri <noreply@example.com>",
    MAVIRI_PUBLIC_URL: "https://maviri.example"
  });
  assert.equal(result.ready, true);
  assert.equal(result.integrationsReady, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.checks.email.provider, "resend");
});

test("readiness WhatsApp accetta una configurazione multi-tenant senza numero globale", () => {
  const checks = readinessChecks({
    WHATSAPP_VERIFY_TOKEN: "verify-token",
    WHATSAPP_ACCESS_TOKEN: "wa-token",
    WHATSAPP_APP_SECRET: "app-secret",
    MAVIRI_WHATSAPP_TENANTS: JSON.stringify({
      "111111": "salone-rosa",
      "222222": "studio-verdi"
    })
  });
  assert.equal(checks.whatsapp.send, true);
  assert.equal(checks.whatsapp.ready, true);
  assert.equal(checks.whatsapp.routedTenants, 2);
  assert.equal(checks.whatsapp.outboundRoutes, 2);
});

test("readiness WhatsApp non considera inviabile una route basata solo sul numero visualizzato", () => {
  const checks = readinessChecks({
    WHATSAPP_VERIFY_TOKEN: "verify-token",
    WHATSAPP_ACCESS_TOKEN: "wa-token",
    WHATSAPP_APP_SECRET: "app-secret",
    MAVIRI_WHATSAPP_TENANTS: JSON.stringify({
      "+39 333 123 4567": "salone-rosa"
    })
  });
  assert.equal(checks.whatsapp.routedTenants, 1);
  assert.equal(checks.whatsapp.outboundRoutes, 0);
  assert.equal(checks.whatsapp.send, false);
  assert.equal(checks.whatsapp.ready, false);
});

test("readiness WhatsApp rifiuta una mappa tenant non valida senza numero globale", () => {
  const checks = readinessChecks({
    WHATSAPP_VERIFY_TOKEN: "verify-token",
    WHATSAPP_ACCESS_TOKEN: "wa-token",
    WHATSAPP_APP_SECRET: "app-secret",
    MAVIRI_WHATSAPP_TENANTS: "{not-json"
  });
  assert.equal(checks.whatsapp.send, false);
  assert.equal(checks.whatsapp.ready, false);
  assert.equal(checks.whatsapp.routedTenants, 0);
  assert.equal(checks.whatsapp.outboundRoutes, 0);
});

test("readiness email richiede la stessa configurazione usata dal recupero password", () => {
  const incomplete = readinessChecks({
    RESEND_API_KEY: "resend-key",
    MAVIRI_EMAIL_FROM: "Maviri <noreply@example.com>"
  });
  assert.equal(incomplete.email.ready, false);

  const complete = readinessChecks({
    RESEND_API_KEY: "resend-key",
    MAVIRI_EMAIL_FROM: "Maviri <noreply@example.com>",
    MAVIRI_PUBLIC_URL: "https://maviri.example"
  });
  assert.equal(complete.email.ready, true);
  assert.equal(complete.email.provider, "resend");
});
