import test from "node:test";
import assert from "node:assert/strict";
import { createMaviOperationalMemory } from "../lib/mavi-operational-memory.js";

const data = {
  clients: [
    { id: "c1", name: "Mario Rossi" },
    { id: "c2", name: "Anna Bianchi" }
  ],
  services: [
    { id: "s1", name: "Taglio" },
    { id: "s2", name: "Colore" }
  ],
  appointments: [
    { id: "a1", name: "Mario Rossi", service: "Taglio", date: "2026-09-04", time: "15:00", status: "confirmed" },
    { id: "a2", name: "Anna Bianchi", service: "Colore", date: "2026-09-05", time: "10:00", status: "confirmed" }
  ]
};

test("ricompone una prenotazione operativa su più messaggi", () => {
  const memory = createMaviOperationalMemory();
  assert.equal(memory.prepare("Prenota Mario Rossi domani", data, "conv-1", 1000).answer, "Quale servizio devo prenotare?");
  assert.equal(memory.prepare("Per il taglio", data, "conv-1", 2000).answer, "A che ora?");
  const result = memory.prepare("Alle 15", data, "conv-1", 3000);
  assert.equal(result.completed, true);
  assert.equal(result.message, "Prenota Mario Rossi per Taglio domani alle 15:00");
  assert.equal(memory.has("conv-1", 3000), false);
});

test("chiede i campi mancanti nell'ordine corretto", () => {
  const memory = createMaviOperationalMemory();
  assert.equal(memory.prepare("Prenota domani alle 16", data, "conv-2", 1000).answer, "Per chi devo prenotare?");
  assert.equal(memory.prepare("Mario Rossi", data, "conv-2", 2000).answer, "Quale servizio devo prenotare?");
});

test("mantiene isolate due conversazioni", () => {
  const memory = createMaviOperationalMemory();
  memory.prepare("Prenota Mario Rossi domani", data, "a", 1000);
  memory.prepare("Prenota Anna Bianchi dopodomani", data, "b", 1000);
  assert.equal(memory.prepare("Taglio", data, "a", 2000).state.client, "Mario Rossi");
  assert.equal(memory.prepare("Colore", data, "b", 2000).state.client, "Anna Bianchi");
});

test("scade lo stato operativo dopo il TTL", () => {
  const memory = createMaviOperationalMemory({ ttlMs: 1000 });
  memory.prepare("Prenota Mario Rossi domani", data, "conv", 1000);
  assert.equal(memory.has("conv", 1500), true);
  assert.equal(memory.has("conv", 2501), false);
  assert.equal(memory.prepare("Taglio", data, "conv", 2600).handled, false);
});

test("annulla un appuntamento solo dopo conferma esplicita", () => {
  const memory = createMaviOperationalMemory();
  const first = memory.prepare("Annulla l'appuntamento di Mario Rossi", data, "cancel", 1000);
  assert.equal(first.handled, true);
  assert.match(first.answer, /Confermi l'annullamento/);
  assert.equal(memory.has("cancel", 1000), true);

  const confirmed = memory.prepare("confermo", data, "cancel", 2000);
  assert.equal(confirmed.completed, true);
  assert.match(confirmed.message, /Confermo: annulla l'appuntamento di Mario Rossi/);
  assert.match(confirmed.message, /2026-09-04/);
  assert.equal(memory.has("cancel", 2000), false);
});

test("sposta un appuntamento raccogliendo nuovo giorno e nuova ora", () => {
  const memory = createMaviOperationalMemory();
  const first = memory.prepare("Sposta l'appuntamento di Anna Bianchi", data, "move", 1000);
  assert.equal(first.answer, "A quale giorno devo spostarlo?");

  const date = memory.prepare("venerdi", data, "move", 2000);
  assert.equal(date.answer, "A che ora devo spostarlo?");

  const time = memory.prepare("alle 16", data, "move", 3000);
  assert.match(time.answer, /Confermi lo spostamento/);

  const confirmed = memory.prepare("ok", data, "move", 4000);
  assert.equal(confirmed.completed, true);
  assert.match(confirmed.message, /Confermo: sposta l'appuntamento di Anna Bianchi/);
  assert.match(confirmed.message, /a venerdi alle 16:00/);
});

test("chiede di distinguere quando più appuntamenti corrispondono", () => {
  const memory = createMaviOperationalMemory();
  const many = {
    ...data,
    appointments: data.appointments.concat({ id: "a3", name: "Mario Rossi", service: "Colore", date: "2026-09-06", time: "11:00", status: "confirmed" })
  };
  const result = memory.prepare("Annulla l'appuntamento di Mario Rossi", many, "amb", 1000);
  assert.equal(result.handled, true);
  assert.match(result.answer, /Quale appuntamento intendi/);
  assert.match(result.answer, /Taglio/);
  assert.match(result.answer, /Colore/);
});

test("ignora appuntamenti già annullati nella selezione", () => {
  const memory = createMaviOperationalMemory();
  const dataset = {
    ...data,
    appointments: [
      { id: "x", name: "Mario Rossi", service: "Colore", date: "2026-09-03", time: "09:00", status: "cancelled" },
      data.appointments[0]
    ]
  };
  const result = memory.prepare("Annulla l'appuntamento di Mario Rossi", dataset, "active", 1000);
  assert.match(result.answer, /2026-09-04/);
  assert.doesNotMatch(result.answer, /2026-09-03/);
});

test("una conferma senza operazione pendente resta al Business Engine", () => {
  const memory = createMaviOperationalMemory();
  const result = memory.prepare("confermo", data, "free", 1000);
  assert.equal(result.handled, false);
  assert.equal(result.message, "confermo");
});
