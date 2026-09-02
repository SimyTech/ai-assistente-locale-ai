import test from "node:test";
import assert from "node:assert/strict";
import { readinessChecks } from "../lib/launch-readiness.js";

const env = publicUrl => ({
  RESEND_API_KEY: "resend-key",
  MAVIRI_EMAIL_FROM: "Maviri <noreply@example.com>",
  MAVIRI_PUBLIC_URL: publicUrl
});

test("readiness email richiede un URL pubblico HTTPS valido", () => {
  assert.equal(readinessChecks(env("https://maviri.example")).email.ready, true);
  assert.equal(readinessChecks(env("http://maviri.example")).email.ready, false);
  assert.equal(readinessChecks(env("https://user:pass@maviri.example")).email.ready, false);
  assert.equal(readinessChecks(env("not-a-url")).email.ready, false);
});
