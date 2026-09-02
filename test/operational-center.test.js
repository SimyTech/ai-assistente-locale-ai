import test from "node:test";
import assert from "node:assert/strict";
import { buildOperationalCenter, findAgendaGaps, findCancellationRecovery, findInactiveClients } from "../lib/operational-center.js";

const now = "2026-09-02T10:00:00Z";

const base = {
  hours: {
    wed: { start: "09:00", end: "18:00", breaks: [{ start: "13:00", end: "14:00" }] },
    thu: { start: "09:00", end: "18:00" }
  },
  services: [
    { name: "Taglio", duration: 30, price: 25 },
    { name: "Colore", duration: 60, price: 55 }
  ],
  clients: [
    { id: "c1", name: "Anna Rossi" },
    { id: "c2", name: "Luca Bianchi" },
    { id: "c3", name: "Marta Verdi" },
    { id: "c4", name: "Giulia Neri" }
  ],
  appointments: [
    { id: "a1", clientId: "c1", name: "Anna Rossi", service: "Taglio", date: "2026-09-02", time: "09:00", status: "confirmed" },
    { id: "a2", clientId: "c2", name: "Luca Bianchi", service: "Colore", date: "2026-09-02", time: "10:00", status: "confirmed" },
    { id: "old1", clientId: "c4", name: "Giulia Neri", service: "Taglio", date: "2026-04-01", time: "09:00", status: "completed" },
    { id: "old2", clientId: "c2", name: "Luca Bianchi", service: "Colore", date: "2026-08-10", time: "09:00", status: "completed" },
    { id: "cancel1", clientId: "c3", name: "Marta Verdi", service: "Colore", date: "2026-08-28", time: "15:00", status: "cancelled" }
  ]
};

test("individua i buchi reali dell'agenda rispettando appuntamenti e pausa", () => {
  const gaps = findAgendaGaps(base, { now, horizonDays: 1, minGapMinutes: 30 });
  assert.deepEqual(gaps.map(gap => [gap.start, gap.end]), [
    ["09:30", "10:00"],
    ["11:00", "13:00"],
    ["14:00", "18:00"]
  ]);
});

test("associa a ogni buco i servizi compatibili e il valore migliore", () => {
  const gaps = findAgendaGaps(base, { now, horizonDays: 1, minGapMinutes: 30 });
  assert.equal(gaps[0].recommendedService.name, "Taglio");
  assert.equal(gaps[0].potentialValue, 25);
  assert.deepEqual(gaps[0].compatibleServices.map(item => item.name), ["Taglio"]);
  assert.equal(gaps[1].recommendedService.name, "Colore");
  assert.equal(gaps[1].potentialValue, 55);
  assert.deepEqual(gaps[1].compatibleServices.map(item => item.name), ["Colore", "Taglio"]);
});

test("individua clienti inattivi ma esclude chi ha un appuntamento futuro", () => {
  const input = structuredClone(base);
  input.appointments.push({ id: "future", clientId: "c4", name: "Giulia Neri", service: "Taglio", date: "2026-09-05", time: "11:00", status: "confirmed" });
  assert.equal(findInactiveClients(input, { now, inactiveDays: 90 }).some(item => item.clientId === "c4"), false);

  const withoutFuture = structuredClone(base);
  const inactive = findInactiveClients(withoutFuture, { now, inactiveDays: 90 });
  assert.equal(inactive[0].clientId, "c4");
  assert.ok(inactive[0].inactiveDays >= 150);
});

test("trasforma cancellazioni non recuperate in opportunità economiche", () => {
  const rows = findCancellationRecovery(base, { now, lookbackDays: 30 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Marta Verdi");
  assert.equal(rows[0].value, 55);
});

test("non propone una cancellazione già recuperata con un nuovo appuntamento", () => {
  const input = structuredClone(base);
  input.appointments.push({ id: "recovered", clientId: "c3", name: "Marta Verdi", service: "Colore", date: "2026-09-04", time: "15:00", status: "confirmed" });
  assert.equal(findCancellationRecovery(input, { now, lookbackDays: 30 }).length, 0);
});

test("non ripropone clienti segnati come contattati di recente", () => {
  const contactedAt = "2026-09-01T10:00:00.000Z";
  const input = {
    ...base,
    clients: base.clients.map(client => ({ ...client, recoveryContactedAt: contactedAt }))
  };
  assert.equal(findInactiveClients(input, { now: "2026-09-02T10:00:00Z", inactiveDays: 90 }).length, 0);
  assert.equal(findCancellationRecovery(input, { now: "2026-09-02T10:00:00Z", lookbackDays: 30 }).length, 0);
});

test("costruisce il Centro Operativo con priorità e valore recuperabile", () => {
  const center = buildOperationalCenter(base, { now, horizonDays: 1, inactiveDays: 90, lookbackDays: 30 });
  assert.equal(center.summary.cancellationRecoveries, 1);
  assert.equal(center.summary.inactiveClients, 1);
  assert.equal(center.summary.agendaGaps, 3);
  assert.equal(center.summary.recoverableValue, 55);
  assert.equal(center.summary.agendaPotentialValue, 135);
  assert.equal(center.summary.totalValueOpportunity, 190);
  assert.equal(center.summary.totalActions, 5);
  assert.equal(center.actions[0].priority, "high");
  assert.ok(center.actions.some(item => item.type === "agenda-gap" && item.label.includes("Colore")));
});
