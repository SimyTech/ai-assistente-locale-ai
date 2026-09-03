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
    { date: "2026-09-01", name: "Anna", service: "Taglio", status: "completed" },
    { date: "2026-09-02", name: "Luca", service: "Barba", status: "completed" },
    { date: "2026-09-02", name: "Anna", service: "Taglio", price: 60, status: "completed" },
    { date: "2026-09-03", name: "Marco", service: "Taglio", status: "confirmed" },
    { date: "2026-09-03", name: "Paola", service: "Barba", status: "cancelled" },
    { date: "2026-09-03", name: "Gianni", service: "Taglio", status: "no-show" },
    { date: "2026-08-01", name: "Anna", service: "Taglio", status: "completed" }
  ]
};

test("calcola solo il valore delle prestazioni completate", () => {
  const answer = answerFastAnalytics("quanto ho incassato questo mese?", data, now);
  assert.match(answer, /questo mese: €140\.00/);
  assert.match(answer, /stima gestionale/);
  assert.match(answer, /non sostituisce la contabilità fiscale/);
});

test("confronta questo mese con il vero mese precedente", () => {
  const answer = answerFastAnalytics("quanto ho incassato questo mese rispetto al mese scorso?", data, now);
  assert.match(answer, /questo mese: €140\.00/);
  assert.match(answer, /Mese precedente: €50\.00/);
  assert.match(answer, /in aumento: \+180\.0% \(\+€90\.00\)/);
});

test("usa il prezzo salvato sull'appuntamento quando presente", () => {
  const custom = { ...data, appointments: [{ date: "2026-09-01", service: "Taglio", price: 75, status: "completed" }] };
  assert.match(answerFastAnalytics("fatturato questo mese", custom, now), /€75\.00/);
});

test("individua il servizio che genera più valore", () => {
  const answer = answerFastAnalytics("quale servizio rende di più questo mese?", data, now);
  assert.match(answer, /Taglio/);
  assert.match(answer, /€110\.00/);
  assert.match(answer, /2 prestazioni completate/);
});

test("individua il cliente che genera più valore", () => {
  const answer = answerFastAnalytics("quale cliente ha generato più valore questo mese?", data, now);
  assert.match(answer, /Anna/);
  assert.match(answer, /€110\.00/);
  assert.match(answer, /2 prestazioni completate/);
});

test("stima il valore perso per cancellazioni", () => {
  const answer = answerFastAnalytics("quanto ho perso per cancellazioni questo mese?", data, now);
  assert.match(answer, /cancellazioni/);
  assert.match(answer, /€30\.00/);
  assert.match(answer, /1 appuntamento/);
});

test("stima il valore perso per no-show", () => {
  const answer = answerFastAnalytics("quanto ho perso per i no-show questo mese?", data, now);
  assert.match(answer, /no-show/);
  assert.match(answer, /€50\.00/);
});

test("non intercetta domande non economiche", () => {
  assert.equal(answerFastAnalytics("chi ho domani?", data, now), null);
});
