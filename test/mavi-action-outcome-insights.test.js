import test from "node:test";
import assert from "node:assert/strict";
import { summarizeActionOutcomes } from "../lib/mavi-action-outcome-insights.js";

const actions = [
  { outcome: "booked", outcomeValue: 70, proposal: { strategy: "targeted-recontact", recommendedService: "Colore", targetBand: "pranzo", sourceType: "weak-time-band" } },
  { outcome: "no-booking", outcomeValue: 0, proposal: { strategy: "targeted-recontact", recommendedService: "Colore", targetBand: "pranzo", sourceType: "weak-time-band" } },
  { outcome: "booked", outcomeValue: 30, proposal: { strategy: "inactive-client", recommendedService: "Taglio", targetBand: "pomeriggio", sourceType: "inactive-client" } },
  { outcome: "declined", outcomeValue: 999, proposal: { strategy: "inactive-client", recommendedService: "Taglio", targetBand: "pomeriggio", sourceType: "inactive-client" } },
  { outcome: null, outcomeValue: 500, proposal: { strategy: "targeted-recontact", recommendedService: "Colore", targetBand: "pranzo" } }
];

test("calcola indicatori usando solo esiti osservati", () => {
  const result = summarizeActionOutcomes(actions);
  assert.equal(result.observed, 4);
  assert.equal(result.booked, 2);
  assert.equal(result.noBooking, 1);
  assert.equal(result.declined, 1);
  assert.equal(result.recoveredValue, 100);
  assert.equal(result.bookingRate, 0.5);
  assert.equal(result.averageBookedValue, 50);
  assert.match(result.note, /solo su esiti osservati/i);
});

test("non attribuisce valore economico a rifiuti o mancate prenotazioni", () => {
  const result = summarizeActionOutcomes(actions, { dimension: "service" });
  const taglio = result.groups.find(row => row.label === "Taglio");
  assert.equal(taglio.observed, 2);
  assert.equal(taglio.booked, 1);
  assert.equal(taglio.declined, 1);
  assert.equal(taglio.recoveredValue, 30);
});

test("ordina i gruppi per tasso osservato e poi per valore", () => {
  const result = summarizeActionOutcomes(actions, { dimension: "service" });
  assert.deepEqual(result.groups.map(row => row.label), ["Colore", "Taglio"]);
  assert.equal(result.bestObservedGroup.label, "Colore");
});

test("può richiedere una base minima di esiti prima di mostrare un gruppo", () => {
  const result = summarizeActionOutcomes(actions, { dimension: "band", minimumObserved: 3 });
  assert.deepEqual(result.groups, []);
  assert.equal(result.bestObservedGroup, null);
});

test("ignora azioni senza un esito valido", () => {
  const result = summarizeActionOutcomes([{ outcome: "unknown", outcomeValue: 100, proposal: { strategy: "x" } }]);
  assert.equal(result.observed, 0);
  assert.equal(result.recoveredValue, 0);
  assert.equal(result.bookingRate, 0);
});
