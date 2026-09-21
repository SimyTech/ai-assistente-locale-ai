import test from "node:test";
import assert from "node:assert/strict";
import { SESSION_COOKIE, SESSION_COOKIE_DOMAIN, cookieValue, createSession, sessionCookie, sessionTenantId, verifySession } from "../lib/session.js";

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

test("recupera il tenant candidato dalla sessione per ripristinare il contesto browser", () => {
  const token = createSession({ tenantId: "salone-anna", secret: "session-secret" });
  assert.equal(sessionTenantId(token), "salone-anna");
  assert.equal(sessionTenantId("non-e-un-token"), "");
  assert.equal(sessionTenantId("e30.firma.parte-extra"), "");
});


test("il cookie di sessione usa il dominio condiviso e una chiave nuova", () => {
  const cookie = sessionCookie("firma-valida");
  assert.match(cookie, new RegExp(`^${SESSION_COOKIE}=`));
  assert.match(cookie, new RegExp(`Domain=${SESSION_COOKIE_DOMAIN.replace(".", "\\.")}`));
  assert.equal(SESSION_COOKIE, "maviri_session_v2");
});
