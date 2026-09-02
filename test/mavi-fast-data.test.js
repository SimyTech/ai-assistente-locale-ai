import test from "node:test";
import assert from "node:assert/strict";
import { answerFastLocalData } from "../lib/mavi-fast-data.js";

const now = new Date(2026, 8, 2, 12, 0, 0);
const data = {
  appointments: [
    { date: "2026-09-02", time: "15:00", name: "Anna", service: "Taglio", status: "confirmed" },
    { date: "2026-09-02", time: "10:00", name: "Luca", service: "Barba", status: "confirmed" },
    { date: "2026-09-02", time: "09:00", name: "Mario", status: "cancelled" }
  ],
  services: [{ name: "Taglio", price: 25, duration: 30 }],
  clients: [{ name: "Anna" }, { name: "Luca" }],
  promotions: [{ title: "Settembre", valid: "fino al 30/09" }]
};

test("risponde subito con i dati locali ordinati di oggi", () => {
  const result = answerFastLocalData("Che appuntamenti ho oggi?", data, now);
  assert.equal(result.handled, true);
  assert.match(result.answer, /10:00 — Luca — Barba[\s\S]*15:00 — Anna — Taglio/);
  assert.doesNotMatch(result.answer, /Mario/);
});

test("risponde subito su clienti, servizi e promozioni", () => {
  assert.match(answerFastLocalData("Quanti clienti ho?", data, now).answer, /2 clienti/);
  assert.match(answerFastLocalData("Quali servizi e prezzi ho?", data, now).answer, /Taglio — €25.00 — 30 min/);
  assert.match(answerFastLocalData("Quali promozioni ci sono?", data, now).answer, /Settembre/);
});

test("non intercetta azioni operative", () => {
  for (const message of ["Prenota un appuntamento oggi", "Sposta l'appuntamento di oggi", "Annulla l'appuntamento"]) {
    assert.equal(answerFastLocalData(message, data, now).handled, false, message);
  }
});

