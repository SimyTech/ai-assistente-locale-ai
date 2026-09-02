import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  listClientAppointments,
  pickNextClientAppointment,
  resolveClientCancellation
} from "../lib/whatsapp-cancellation.js";

test("seleziona l'appuntamento del cliente WhatsApp quando è l'unico futuro", () => {
  const appointments = [
    { id: "other", status: "confirmed", date: "2026-09-03", time: "09:00", phone: "+39 333 9999999" },
    { id: "next", status: "confirmed", date: "2026-09-03", time: "11:00", whatsapp: "3331234567" },
    { id: "past", status: "confirmed", date: "2026-09-01", time: "11:00", phone: "3331234567" },
    { id: "cancelled", status: "cancelled", date: "2026-09-02", time: "12:00", phone: "3331234567" }
  ];
  const selected = pickNextClientAppointment(appointments, { phone: "+39 333 1234567", whatsapp: "+39 333 1234567" }, "2026-09-02");
  assert.equal(selected?.id, "next");
});

test("non annulla automaticamente quando il cliente ha più appuntamenti futuri", () => {
  const appointments = [
    { id: "first", status: "confirmed", date: "2026-09-03", time: "11:00", phone: "3331234567", service: "Taglio" },
    { id: "second", status: "confirmed", date: "2026-09-05", time: "10:00", phone: "3331234567", service: "Colore" }
  ];
  const matches = listClientAppointments(appointments, { phone: "3331234567" }, "2026-09-02");
  const selected = pickNextClientAppointment(appointments, { phone: "3331234567" }, "2026-09-02");
  const resolution = resolveClientCancellation(appointments, { phone: "3331234567" }, "2026-09-02", "annulla");
  assert.deepEqual(matches.map(item => item.id), ["first", "second"]);
  assert.equal(selected, null);
  assert.equal(resolution.appointment, null);
  assert.equal(resolution.ambiguous, true);
});

test("risolve un annullamento ambiguo tramite orario", () => {
  const appointments = [
    { id: "first", status: "confirmed", date: "2026-09-03", time: "11:00", phone: "3331234567", service: "Taglio" },
    { id: "second", status: "confirmed", date: "2026-09-05", time: "10:00", phone: "3331234567", service: "Colore" }
  ];
  const resolution = resolveClientCancellation(
    appointments,
    { phone: "3331234567" },
    "2026-09-02",
    "annulla quello delle 10:00"
  );
  assert.equal(resolution.appointment?.id, "second");
  assert.equal(resolution.ambiguous, false);
});

test("risolve un annullamento ambiguo tramite servizio", () => {
  const appointments = [
    { id: "first", status: "confirmed", date: "2026-09-03", time: "11:00", phone: "3331234567", service: "Taglio" },
    { id: "second", status: "confirmed", date: "2026-09-05", time: "10:00", phone: "3331234567", service: "Colore" }
  ];
  const resolution = resolveClientCancellation(
    appointments,
    { phone: "3331234567" },
    "2026-09-02",
    "annulla il colore"
  );
  assert.equal(resolution.appointment?.id, "second");
});

test("risolve un annullamento ambiguo con domani e dopodomani", () => {
  const appointments = [
    { id: "tomorrow", status: "confirmed", date: "2026-09-03", time: "11:00", phone: "3331234567", service: "Taglio" },
    { id: "day-after", status: "confirmed", date: "2026-09-04", time: "10:00", phone: "3331234567", service: "Colore" }
  ];

  const tomorrow = resolveClientCancellation(
    appointments,
    { phone: "3331234567" },
    "2026-09-02",
    "annulla quello di domani"
  );
  const dayAfter = resolveClientCancellation(
    appointments,
    { phone: "3331234567" },
    "2026-09-02",
    "annulla quello di dopodomani"
  );

  assert.equal(tomorrow.appointment?.id, "tomorrow");
  assert.equal(dayAfter.appointment?.id, "day-after");
});

test("risolve un annullamento ambiguo tramite giorno della settimana in italiano", () => {
  const appointments = [
    { id: "thursday", status: "confirmed", date: "2026-09-03", time: "11:00", phone: "3331234567", service: "Taglio" },
    { id: "friday", status: "confirmed", date: "2026-09-04", time: "10:00", phone: "3331234567", service: "Colore" }
  ];

  const resolution = resolveClientCancellation(
    appointments,
    { phone: "3331234567" },
    "2026-09-02",
    "annulla l'appuntamento di venerdì"
  );

  assert.equal(resolution.appointment?.id, "friday");
  assert.equal(resolution.ambiguous, false);
});

test("combina giorno naturale e orario quando ci sono più appuntamenti nello stesso giorno", () => {
  const appointments = [
    { id: "morning", status: "confirmed", date: "2026-09-04", time: "09:00", phone: "3331234567", service: "Taglio" },
    { id: "afternoon", status: "confirmed", date: "2026-09-04", time: "15:00", phone: "3331234567", service: "Colore" }
  ];

  const resolution = resolveClientCancellation(
    appointments,
    { phone: "3331234567" },
    "2026-09-02",
    "annulla venerdì alle 15"
  );

  assert.equal(resolution.appointment?.id, "afternoon");
});

test("non seleziona appuntamenti appartenenti ad altri numeri", () => {
  const selected = pickNextClientAppointment([
    { id: "a", status: "confirmed", date: "2026-09-03", time: "10:00", phone: "3339999999" }
  ], { phone: "3331234567" }, "2026-09-02");
  assert.equal(selected, null);
});

test("WhatsApp persiste l'annullamento sul database condiviso", async () => {
  const whatsapp = await readFile(new URL("../api/whatsapp.js", import.meta.url), "utf8");
  assert.match(whatsapp, /function cancelRequestedAppointment/);
  assert.match(whatsapp, /tenantDataKey\(tenantId\)/);
  assert.match(whatsapp, /resolveClientCancellation/);
  assert.match(whatsapp, /status: "cancelled"/);
  assert.match(whatsapp, /Annullato dal cliente via WhatsApp/);
  assert.match(whatsapp, /Quale vuoi annullare\?/);
  assert.match(whatsapp, /await redisSet\(key, nextData\)/);
  assert.match(whatsapp, /cancelRequestedAppointment\(\{ tenantId, phone, text, session \}\)/);
});
