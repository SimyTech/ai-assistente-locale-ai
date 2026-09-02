import test from "node:test";
import assert from "node:assert/strict";
import "../recovery-metrics.js";

const metrics = globalThis.maviriRecoveryMetrics;
const now = "2026-09-02T12:00:00.000Z";

test("attribuisce la conversione al cliente contattato dopo il richiamo", () => {
  const result = metrics(
    [
      { id: "c1", name: "Anna", recoveryContactedAt: "2026-09-01T09:00:00.000Z" },
      { id: "c2", name: "Luca", recoveryContactedAt: "2026-09-01T10:00:00.000Z" }
    ],
    [
      { clientId: "c1", source: "operational-recovery", status: "confirmed", createdAt: "2026-09-01T09:30:00.000Z" },
      { clientId: "c3", source: "smart-rebooking", status: "confirmed", createdAt: "2026-09-01T11:00:00.000Z" }
    ],
    { now }
  );
  assert.deepEqual(result, { contacts: 2, conversions: 1, conversionRate: 50 });
});

test("conta una sola conversione per cliente anche con più prenotazioni", () => {
  const result = metrics(
    [{ id: "c1", recoveryContactedAt: "2026-09-01T09:00:00.000Z" }],
    [
      { clientId: "c1", source: "smart-rebooking", status: "confirmed", createdAt: "2026-09-01T10:00:00.000Z" },
      { clientId: "c1", source: "operational-recovery", status: "completed", createdAt: "2026-09-01T11:00:00.000Z" }
    ],
    { now }
  );
  assert.deepEqual(result, { contacts: 1, conversions: 1, conversionRate: 100 });
});

test("esclude prenotazioni precedenti al contatto, annullate o senza data di creazione", () => {
  const result = metrics(
    [{ id: "c1", recoveryContactedAt: "2026-09-01T09:00:00.000Z" }],
    [
      { clientId: "c1", source: "smart-rebooking", status: "confirmed", createdAt: "2026-09-01T08:00:00.000Z" },
      { clientId: "c1", source: "operational-recovery", status: "cancelled", createdAt: "2026-09-01T10:00:00.000Z" },
      { clientId: "c1", source: "operational-recovery", status: "confirmed", date: "2026-09-10", time: "10:00" }
    ],
    { now }
  );
  assert.deepEqual(result, { contacts: 1, conversions: 0, conversionRate: 0 });
});

test("usa il nome solo come fallback per i dati storici senza clientId", () => {
  const result = metrics(
    [{ name: "Giulia Neri", rebookingContactedAt: "2026-09-01T09:00:00.000Z" }],
    [{ name: "giulia neri", source: "smart-rebooking", status: "confirmed", createdAt: "2026-09-01T10:00:00.000Z" }],
    { now }
  );
  assert.deepEqual(result, { contacts: 1, conversions: 1, conversionRate: 100 });
});

test("ignora i contatti fuori dalla finestra di trenta giorni", () => {
  const result = metrics(
    [{ id: "c1", recoveryContactedAt: "2026-07-01T09:00:00.000Z" }],
    [{ clientId: "c1", source: "smart-rebooking", status: "confirmed", createdAt: "2026-09-01T10:00:00.000Z" }],
    { now }
  );
  assert.deepEqual(result, { contacts: 0, conversions: 0, conversionRate: 0 });
});
