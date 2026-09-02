import test from "node:test";
import assert from "node:assert/strict";
import { publicHttpsUrl, validPublicHttpsUrl } from "../lib/public-url.js";
import { recoveryEmailConfigured } from "../lib/account-recovery.js";
import { emailVerificationConfigured } from "../lib/email-verification.js";

const emailEnv = publicUrl => ({
  RESEND_API_KEY: "resend-key",
  MAVIRI_EMAIL_FROM: "Maviri <noreply@example.com>",
  MAVIRI_PUBLIC_URL: publicUrl
});

test("accetta solo URL pubblici HTTPS senza credenziali", () => {
  assert.equal(publicHttpsUrl("https://maviri.example/"), "https://maviri.example");
  assert.equal(validPublicHttpsUrl("https://maviri.example/path"), true);
  assert.equal(validPublicHttpsUrl("http://maviri.example"), false);
  assert.equal(validPublicHttpsUrl("https://user:pass@maviri.example"), false);
  assert.equal(validPublicHttpsUrl("not-a-url"), false);
  assert.equal(validPublicHttpsUrl(""), false);
});

test("reset password e verifica email condividono la stessa regola HTTPS", () => {
  assert.equal(recoveryEmailConfigured(emailEnv("https://maviri.example")), true);
  assert.equal(emailVerificationConfigured(emailEnv("https://maviri.example")), true);
  assert.equal(recoveryEmailConfigured(emailEnv("http://maviri.example")), false);
  assert.equal(emailVerificationConfigured(emailEnv("http://maviri.example")), false);
  assert.equal(recoveryEmailConfigured(emailEnv("not-a-url")), false);
  assert.equal(emailVerificationConfigured(emailEnv("not-a-url")), false);
});
