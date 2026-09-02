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

test("annullamento e spostamento azzerano una prenotazione incompleta", () => {
  for (const message of ["annulla", "sposta a venerdì"]) {
    const memory = createMaviOperationalMemory();
    memory.prepare("Prenota Mario Rossi domani", data, "conv", 1000);
    const result = memory.prepare(message, data, "conv", 2000);
    assert.equal(result.handled, false);
    assert.equal(result.message, message);
    assert.equal(memory.has("conv", 2000), false);
  }
});

test("una conferma resta al Business Engine senza essere riscritta", () => {
  const memory = createMaviOperationalMemory();
  memory.prepare("Prenota Mario Rossi domani", data, "conv", 1000);
  const result = memory.prepare("confermo", data, "conv", 2000);
  assert.equal(result.handled, false);
  assert.equal(result.message, "confermo");
});
