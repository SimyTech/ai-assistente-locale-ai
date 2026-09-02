import test from "node:test";
import assert from "node:assert/strict";

import {
  awaitingField,
  bookingComplete,
  bookingSummary,
  extractTime,
  isCancellation,
  isConfirmation,
  mergeBooking,
  normalizeBooking
} from "../lib/whatsapp-booking.js";

test("mantiene i dati raccolti tra messaggi WhatsApp", () => {
  let booking = mergeBooking({}, { status: "collecting-time", service: "Taglio uomo", date: "2026-09-02" });
  booking = mergeBooking(booking, { time: "15:30" });
  booking = mergeBooking(booking, { name: "Mario Rossi" });

  assert.equal(booking.service, "Taglio uomo");
  assert.equal(booking.date, "2026-09-02");
  assert.equal(booking.time, "15:30");
  assert.equal(booking.name, "Mario Rossi");
  assert.equal(bookingComplete(booking), true);
  assert.equal(awaitingField(booking), "confirmation");
});

test("mantiene il contesto attraversando tutti gli stati della prenotazione", () => {
  let booking = mergeBooking({}, { status: "collecting-service" });
  booking = mergeBooking(booking, { status: "collecting-date", service: "Taglio uomo" });
  booking = mergeBooking(booking, { status: "collecting-time", date: "2026-09-03" });
  booking = mergeBooking(booking, { status: "collecting-name", time: "15:30" });
  booking = mergeBooking(booking, { status: "awaiting-confirmation", name: "Mario Rossi" });
  assert.equal(bookingSummary(booking), "Taglio uomo il 2026-09-03 alle 15:30 per Mario Rossi");
  assert.equal(bookingComplete(booking), true);
});

test("riconosce orari WhatsApp espliciti", () => {
  assert.equal(extractTime("alle 9:30"), "09:30");
  assert.equal(extractTime("15.00 va bene"), "15:00");
  assert.equal(extractTime("domani pomeriggio"), "");
});

test("riconosce conferma e annullamento", () => {
  assert.equal(isConfirmation("Sì confermo"), true);
  assert.equal(isConfirmation("ok"), true);
  assert.equal(isConfirmation("Presente"), true);
  assert.equal(isConfirmation("Ci sono"), true);
  assert.equal(isConfirmation("Ci sarò"), true);
  assert.equal(isConfirmation("confermato"), true);
  assert.equal(isConfirmation("non confermo"), false);
  assert.equal(isConfirmation("no, non ci sono"), false);
  assert.equal(isConfirmation("sì, ma non confermo"), false);
  assert.equal(isConfirmation("ok, annulla"), false);
  assert.equal(isConfirmation("va bene, lascia perdere"), false);
  assert.equal(isConfirmation("perfetto, non prenotare"), false);
  assert.equal(isConfirmation("confermo l'annullamento"), true);
  assert.equal(isCancellation("annulla tutto"), true);
  assert.equal(isCancellation("lascia perdere"), true);
  assert.equal(isCancellation("non posso venire"), true);
  assert.equal(isCancellation("non riesco a esserci"), true);
  assert.equal(isCancellation("non vengo domani"), true);
  assert.equal(isCancellation("non ci sarò"), true);
  assert.equal(isCancellation("devo annullare"), true);
  assert.equal(isCancellation("vorrei annullare"), true);
  assert.equal(isCancellation("ci sarò"), false);
  assert.equal(isCancellation("posso venire"), false);
});

test("normalizza e riassume una prenotazione", () => {
  const booking = normalizeBooking({
    status: "awaiting-confirmation",
    service: "Piega",
    date: "2026-09-03",
    time: "10:00",
    name: "Anna"
  });
  assert.equal(bookingSummary(booking), "Piega il 2026-09-03 alle 10:00 per Anna");
});
