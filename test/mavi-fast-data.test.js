import test from "node:test";
import assert from "node:assert/strict";
import { answerFastLocalData } from "../lib/mavi-fast-data.js";

const now = new Date(2026, 8, 2, 12, 0, 0);
const data = {
  appointments: [
    { date: "2026-09-02", time: "15:00", name: "Anna", service: "Taglio", status: "confirmed" },
    { date: "2026-09-02", time: "10:00", name: "Luca", service: "Barba", status: "confirmed" },
    { date: "2026-09-02", time: "09:00", name: "Mario", status: "cancelled" },
    { date: "2026-09-04", time: "11:00", name: "Paola", service: "Taglio", status: "confirmed" },
    { date: "2026-10-15", time: "14:00", name: "Giulia", service: "Taglio", status: "confirmed" }
  ],
  services: [{ name: "Taglio", price: 25, duration: 30 }, { name: "Barba", price: 15, duration: 20 }],
  clients: [{ name: "Anna" }, { name: "Luca" }],
  promotions: [{ title: "Settembre", valid: "fino al 30/09" }],
  settings: { hours: [
    { name: "Lunedì", open: "09:00", close: "18:00", closed: false },
    { name: "Martedì", closed: true }
  ] },
  business: { address: "Via Roma 10", phone: "0523123456" }
};

test("risponde subito con i dati locali ordinati di oggi", () => {
  const result = answerFastLocalData("Che appuntamenti ho oggi?", data, now);
  assert.equal(result.handled, true);
  assert.match(result.answer, /10:00 — Luca — Barba[\s\S]*15:00 — Anna — Taglio/);
  assert.doesNotMatch(result.answer, /Mario/);
});

test("filtra l'agenda per fascia oraria", () => {
  const result = answerFastLocalData("Che appuntamenti ho oggi solo nel pomeriggio?", data, now);
  assert.equal(result.handled, true);
  assert.match(result.answer, /15:00 — Anna — Taglio/);
  assert.doesNotMatch(result.answer, /10:00 — Luca/);
});

test("può mostrare esplicitamente gli appuntamenti cancellati", () => {
  const result = answerFastLocalData("Che appuntamenti ho oggi tra quelli cancellati?", data, now);
  assert.equal(result.handled, true);
  assert.match(result.answer, /09:00 — Mario — annullato/);
  assert.doesNotMatch(result.answer, /Anna|Luca/);
});

test("filtra l'agenda per cliente anche se il nome esiste solo negli appuntamenti", () => {
  const result = answerFastLocalData("Che appuntamenti ho venerdì con Paola?", data, now);
  assert.equal(result.handled, true);
  assert.match(result.answer, /11:00 — Paola — Taglio/);
  assert.doesNotMatch(result.answer, /Anna|Luca/);
});

test("filtra l'agenda per servizio e combina più filtri", () => {
  const taglio = answerFastLocalData("Che appuntamenti di Taglio ho questo mese?", data, now);
  assert.match(taglio.answer, /Anna — Taglio[\s\S]*Paola — Taglio/);
  assert.doesNotMatch(taglio.answer, /Luca — Barba/);
  const combined = answerFastLocalData("Che appuntamenti di Taglio ho oggi nel pomeriggio con Anna?", data, now);
  assert.match(combined.answer, /15:00 — Anna — Taglio/);
  assert.doesNotMatch(combined.answer, /Luca/);
});

test("risponde subito su clienti, servizi e promozioni", () => {
  assert.match(answerFastLocalData("Quanti clienti ho?", data, now).answer, /2 clienti/);
  assert.match(answerFastLocalData("Quali servizi e prezzi ho?", data, now).answer, /Taglio — €25.00 — 30 min/);
  assert.match(answerFastLocalData("Quali promozioni ci sono?", data, now).answer, /Settembre/);
});

test("risponde subito al piano di oggi senza passare dalla rete", () => {
  for (const question of ["Cosa ho da fare oggi?","Dimmi cosa ho oggi da fare","Che devo gestire oggi?","Dimmi il programma di oggi","Come sono messo oggi?","Chi vedo oggi?","Che faccio oggi?","Com'è la mia agenda oggi?","Oggi che si fa?","Che facciamo oggi?","Cosa c'è da fare oggi?","Oggi cosa mi aspetta?","Che abbiamo oggi?","Oggi com'è la situazione?","Cos'ho oggi?","Oggi?"]) {
    const result = answerFastLocalData(question, data, now);
    assert.equal(result.handled, true, question);
    assert.match(result.answer, /Programma di oggi/);
    assert.match(result.answer, /10:00 — Luca — Barba[\s\S]*15:00 — Anna — Taglio/);
    assert.match(result.answer, /Azioni da gestire/);
  }
});

test("capisce formulazioni diverse per gli altri dati locali", () => {
  assert.match(answerFastLocalData("Fammi vedere il listino", data, now).answer, /Taglio — €25\.00/);
  assert.match(answerFastLocalData("Cosa offro ai clienti?", data, now).answer, /Servizi configurati/);
  assert.match(answerFastLocalData("Quante persone ho in rubrica?", data, now).answer, /2 clienti/);
  assert.match(answerFastLocalData("Ci sono sconti attivi?", data, now).answer, /Settembre/);
  assert.match(answerFastLocalData("Quando apriamo?", data, now).answer, /Lunedì — 09:00–18:00/);
  assert.match(answerFastLocalData("Dove siamo?", data, now).answer, /Via Roma 10/);
  assert.match(answerFastLocalData("Qual è il numero di telefono dell'attività?", data, now).answer, /0523123456/);
});

test("non scambia una richiesta di modifica per una lettura locale", () => {
  assert.equal(answerFastLocalData("Sposta il programma di oggi", data, now).handled, false);
  assert.equal(answerFastLocalData("Modifica gli orari", data, now).handled, false);
  assert.equal(answerFastLocalData("Aggiungi una promozione", data, now).handled, false);
});

test("legge giorni, date e mesi diversi senza rete", () => {
  assert.match(answerFastLocalData("Che appuntamenti ho dopodomani?", data, now).answer, /11:00 — Paola/);
  assert.match(answerFastLocalData("Mostrami l'agenda del 15 ottobre", data, now).answer, /14:00 — Giulia/);
  assert.match(answerFastLocalData("Qual è il programma del mese prossimo?", data, now).answer, /2026-10-15.*Giulia/);
  assert.match(answerFastLocalData("Fammi un recap degli ultimi 10 giorni", data, now).answer, /Luca/);
  assert.match(answerFastLocalData("In questo mese?", data, now).answer, /2026-09-02.*Luca/);
});

test("non intercetta azioni operative", () => {
  for (const message of ["Prenota un appuntamento oggi", "Sposta l'appuntamento di oggi", "Annulla l'appuntamento"]) {
    assert.equal(answerFastLocalData(message, data, now).handled, false, message);
  }
});
