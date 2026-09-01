import test from "node:test";
import assert from "node:assert/strict";
import { cookieValue, createSession, verifySession } from "../lib/session.js";

test("crea una sessione valida solo per il tenant corretto", () => {
  const now = Date.UTC(2026, 8, 1, 12, 0, 0);
  const token = createSession({ tenantId: "salone-uno", secret: "session-secret", now });
  assert.equal(verifySession(token, { tenantId: "salone-uno", secret: "session-secret", now }), true);
  assert.equal(verifySession(token, { tenantId: "salone-due", secret: "session-secret", now }), false);
});

test("rifiuta sessioni alterate o scadute", () => {
  const now = Date.UTC(2026, 8, 1, 12, 0, 0);
  const token = createSession({ tenantId: "default", secret: "session-secret", now });
  assert.equal(verifySession(`${token}x`, { tenantId: "default", secret: "session-secret", now }), false);
  assert.equal(verifySession(token, { tenantId: "default", secret: "session-secret", now: now + 13 * 60 * 60 * 1000 }), false);
});

test("estrae il cookie di sessione senza confonderlo con altri cookie", () => {
  assert.equal(cookieValue({ headers: { cookie: "theme=dark; maviri_session=abc.def; x=1" } }), "abc.def");
});
