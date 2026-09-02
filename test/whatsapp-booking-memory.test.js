import test from "node:test";
import assert from "node:assert/strict";
import { bookingContinuationMessage } from "../api/whatsapp.js";
import { mergeBooking, normalizeBooking } from "../lib/whatsapp-booking.js";

test("ricostruisce il contesto quando il cliente risponde solo con il servizio", () => {
  const booking = normalizeBooking({ status: "collecting-service" });
  assert.equal(bookingContinuationMessage(booking, "Taglio uomo"), "Vorrei prenotare Taglio uomo");
});

test("ricostruisce il contesto quando il cliente risponde solo con il giorno", () => {
  const booking = normalizeBooking({ status: "collecting-date", service: "Taglio uomo" });
  assert.equal(bookingContinuationMessage(booking, "domani"), "Vorrei prenotare Taglio uomo domani");
});

test("mantiene i campi precedenti quando Mavi scopre il dato successivo", () => {
  const current = { status: "collecting-date", service: "Taglio uomo" };
  const discovered = { status: "collecting-time", service: "Taglio uomo", date: "2026-09-03" };
  assert.deepEqual(mergeBooking(current, discovered), {
    status: "collecting-time",
    service: "Taglio uomo",
    date: "2026-09-03",
    time: "",
    name: ""
  });
});

test("non ricostruisce il messaggio per ora e nome già contestualizzati", () => {
  assert.equal(bookingContinuationMessage({ status: "collecting-time", service: "Taglio", date: "2026-09-03" }, "alle 15"), "alle 15");
  assert.equal(bookingContinuationMessage({ status: "collecting-name", service: "Taglio", date: "2026-09-03", time: "15:00" }, "Mario Rossi"), "Mario Rossi");
});
