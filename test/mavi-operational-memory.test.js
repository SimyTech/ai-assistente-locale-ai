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

  const first = memory.prepare("Prenota Mario Rossi domani", data, "conv-1", 1000);
  assert.equal(first.handled, true);
  assert.equal(first.answer, "Quale servizio devo prenotare?");

  const second = memory.prepare("Per il taglio", data, "conv-1", 2000);
  assert.equal(second.handled, true);
  assert.equal(second.answer, "A che ora?");

  const third = memory.prepare("Alle 15", data, "conv-1", 3000);
  assert.equal(third.handled, false);
  assert.equal(third.completed, true);
  assert.equal(third.message, "Prenota Mario Rossi per Taglio domani alle 15:00");
  assert.equal(memory.has("conv-1", 3000), false);
});

test("chiede i campi mancanti nell'ordine corretto", () => {
  const memory = createMaviOperationalMemory();
  const result = memory.prepare("Prenota domani alle 16", data, "conv-2", 1000);
  assert.equal(result.handled, true);
  assert.equal(result.answer, "Per chi devo prenotare?");

  const client = memory.prepare("Mario Rossi", data, "conv-2", 2000);
  assert.equal(client.answer, "Quale servizio devo prenotare?");
});

test("mantiene isolate due conversazioni", () => {
  const memory = createMaviOperationalMemory();
  memory.prepare("Prenota Mario Rossi domani", data, "a", 1000);
  memory.prepare("Prenota Anna Bianchi dopodomani", data, "b", 1000);

  const a = memory.prepare("Taglio", data, "a", 2000);
  const b = memory.prepare("Colore", data, "b", 2000);

  assert.equal(a.state.client, "Mario Rossi");
  assert.equal(b.state.client, "Anna Bianchi");
});

test("scade lo stato operativo dopo il TTL", () => {
  const memory = createMaviOperationalMemory({ ttlMs: 1000 });
  memory.prepare("Prenota Mario Rossi domani", data, "conv", 1000);
  assert.equal(memory.has("conv", 1500), true);
  assert.equal(memory.has("conv", 2501), false);

  const followup = memory.prepare("Taglio", data, "conv", 2600);
  assert.equal(followup.handled, false);
});

test("non intercetta annullamento, spostamento o conferma", () => {
  const memory = createMaviOperationalMemory();
  memory.prepare("Prenota Mario Rossi domani", data, "conv", 1000);

  for (const message of ["annulla", "sposta a venerdì", "confermo"]) {
    const result = memory.prepare(message, data, "conv", 2000);
    assert.equal(result.handled, false);
    assert.equal(result.message, message);
  }
});
