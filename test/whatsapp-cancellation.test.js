import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  listClientAppointments,
  pickNextClientAppointment
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
    { id: "first", status: "confirmed", date: "2026-09-03", time: "11:00", phone: "3331234567" },
    { id: "second", status: "confirmed", date: "2026-09-05", time: "10:00", phone: "3331234567" }
  ];
  const matches = listClientAppointments(appointments, { phone: "3331234567" }, "2026-09-02");
  const selected = pickNextClientAppointment(appointments, { phone: "3331234567" }, "2026-09-02");
  assert.deepEqual(matches.map(item => item.id), ["first", "second"]);
  assert.equal(selected, null);
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
  assert.match(whatsapp, /status: "cancelled"/);
  assert.match(whatsapp, /Annullato dal cliente via WhatsApp/);
  assert.match(whatsapp, /await redisSet\(key, nextData\)/);
  assert.match(whatsapp, /cancelRequestedAppointment\(\{ tenantId, phone, text, session \}\)/);
});
