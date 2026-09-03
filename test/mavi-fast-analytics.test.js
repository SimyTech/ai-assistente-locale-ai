import test from "node:test";
import assert from "node:assert/strict";
import { answerFastAnalytics } from "../lib/mavi-fast-analytics.js";

const now = new Date(2026, 8, 3, 12, 0, 0);
const data = {
  services: [
    { name: "Taglio", price: 50 },
    { name: "Barba", price: 30 }
  ],
  appointments: [
    { date: "2026-09-01", service: "Taglio", status: "completed" },
    { date: "2026-09-02", service: "Barba", status: "completed" },
    { date: "2026-09-03", service: "Taglio", status: "confirmed" },
    { date: "2026-09-03", service: "Barba", status: "cancelled" },
    { date: "2026-08-01", service: "Taglio", status: "completed" }
  ]
};

test("calcola solo il valore delle prestazioni completate", () => {
  const answer = answerFastAnalytics("quanto ho incassato questo mese?", data, now);
  assert.match(answer, /questo mese: €80\.00/);
  assert.match(answer, /stima gestionale/);
  assert.match(answer, /non sostituisce la contabilità fiscale/);
});

test("confronta questo mese con il vero mese precedente", () => {
  const answer = answerFastAnalytics("quanto ho incassato questo mese rispetto al mese scorso?", data, now);
  assert.match(answer, /questo mese: €80\.00/);
  assert.match(answer, /Mese precedente: €50\.00/);
  assert.match(answer, /in aumento: \+60\.0% \(\+€30\.00\)/);
});

test("usa il prezzo salvato sull'appuntamento quando presente", () => {
  const custom = { ...data, appointments: [{ date: "2026-09-01", service: "Taglio", price: 75, status: "completed" }] };
  assert.match(answerFastAnalytics("fatturato questo mese", custom, now), /€75\.00/);
});

test("non intercetta domande non economiche", () => {
  assert.equal(answerFastAnalytics("chi ho domani?", data, now), null);
});
