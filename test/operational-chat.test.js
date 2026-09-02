import test from "node:test";
import assert from "node:assert/strict";
import { buildOperationalChatResponse, isOperationalCenterQuestion } from "../lib/operational-chat.js";

const body = {
  action: "chat",
  role: "owner",
  message: "Mavi, mostrami il centro operativo",
  settings: {
    hours: [
      { start: "09:00", end: "18:00" },
      { start: "09:00", end: "18:00" },
      { start: "09:00", end: "18:00", breaks: [{ start: "13:00", end: "14:00" }] },
      { start: "09:00", end: "18:00" },
      { start: "09:00", end: "18:00" },
      { closed: true },
      { closed: true }
    ]
  },
  services: [{ name: "Taglio", duration: 30, price: 25 }],
  clients: [{ id: "c1", name: "Anna Rossi" }, { id: "c2", name: "Marta Verdi" }],
  appointments: [
    { id: "a1", clientId: "c1", name: "Anna Rossi", service: "Taglio", date: "2026-04-01", time: "10:00", status: "completed" },
    { id: "a2", clientId: "c2", name: "Marta Verdi", service: "Taglio", date: "2026-08-30", time: "15:00", status: "cancelled" }
  ]
};

test("riconosce le richieste al Centro Operativo solo nella chat titolare", () => {
  assert.equal(isOperationalCenterQuestion(body), true);
  assert.equal(isOperationalCenterQuestion({ ...body, role: "client" }), false);
  assert.equal(isOperationalCenterQuestion({ ...body, message: "che appuntamenti ho domani?" }), false);
});

test("Mavi restituisce priorità operative e valore recuperabile strutturato", () => {
  const result = buildOperationalChatResponse(body, { now: "2026-09-02T10:00:00Z", horizonDays: 1, inactiveDays: 90, lookbackDays: 30 });
  assert.ok(result);
  assert.equal(result.center.summary.inactiveClients, 1);
  assert.equal(result.center.summary.cancellationRecoveries, 1);
  assert.equal(result.center.summary.recoverableValue, 25);
  assert.equal(result.center.summary.agendaPotentialValue, 50);
  assert.equal(result.center.summary.totalValueOpportunity, 75);
  assert.match(result.answer, /Centro Operativo Mavi/);
  assert.match(result.answer, /Anna Rossi/);
  assert.match(result.answer, /Marta Verdi/);
  assert.match(result.answer, /Opportunità economica complessiva: €75\.00/);
  assert.match(result.answer, /prova Taglio/);
});

test("riconosce domande naturali su buchi e valore recuperabile", () => {
  assert.equal(isOperationalCenterQuestion({ ...body, message: "dove posso recuperare fatturato?" }), true);
  assert.equal(isOperationalCenterQuestion({ ...body, message: "ci sono buchi in agenda?" }), true);
});
