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
    EMAIL_PROVIDER: "resend",
    RESEND_API_KEY: "resend-key",
    EMAIL_FROM: "Maviri <noreply@example.com>"
  });
  assert.equal(result.ready, true);
  assert.equal(result.integrationsReady, true);
  assert.deepEqual(result.blockers, []);
});

test("provider email webhook è pronto con URL configurato", () => {
  const checks = readinessChecks({
    EMAIL_PROVIDER: "webhook",
    EMAIL_WEBHOOK_URL: "https://example.com/mail"
  });
  assert.equal(checks.email.ready, true);
  assert.equal(checks.email.provider, "webhook");
});
