import test from "node:test";
import assert from "node:assert/strict";
import { clientOwnsAppointment, normalizePhone, ownerAuthorized, ownerTokenForTenant } from "../lib/auth.js";

test("usa il token storico solo per il tenant default", () => {
  const env = { MAVIRI_OWNER_SYNC_TOKEN: "legacy-secret" };
  assert.equal(ownerTokenForTenant("default", env), "legacy-secret");
  assert.equal(ownerTokenForTenant("salone-uno", env), "");
});

test("risolve token distinti per attività", () => {
  const env = { MAVIRI_OWNER_TOKENS: JSON.stringify({ "salone-uno": "token-a", "salone-due": "token-b" }) };
  assert.equal(ownerTokenForTenant("salone-uno", env), "token-a");
  assert.equal(ownerTokenForTenant("salone-due", env), "token-b");
  assert.equal(ownerAuthorized({ headers: { "x-maviri-owner-token": "token-a" } }, "salone-uno", env), true);
  assert.equal(ownerAuthorized({ headers: { "x-maviri-owner-token": "token-a" } }, "salone-due", env), false);
});

test("un JSON token non valido non degrada su un segreto globale", () => {
  const env = { MAVIRI_OWNER_TOKENS: "{non-json", MAVIRI_OWNER_SYNC_TOKEN: "legacy-secret" };
  assert.equal(ownerTokenForTenant("default", env), "");
});

test("verifica la proprietà cliente tramite telefono normalizzato", () => {
  const appointment = { phone: "+39 333 123 4567" };
  assert.equal(normalizePhone("0039-333-123-4567"), "3331234567");
  assert.equal(clientOwnsAppointment(appointment, { clientPhone: "3331234567" }), true);
  assert.equal(clientOwnsAppointment(appointment, { phone: "3330000000" }), false);
  assert.equal(clientOwnsAppointment({ id: "a1" }, { phone: "3331234567" }), false);
});
