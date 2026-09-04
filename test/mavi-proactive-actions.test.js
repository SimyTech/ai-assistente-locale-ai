import test from "node:test";
import assert from "node:assert/strict";
import { createMaviProactiveActions } from "../lib/mavi-proactive-actions.js";

const data = {
  business: { name: "Studio Mavi" },
  services: [
    { name: "Taglio", price: 30 },
    { name: "Colore", price: 70 }
  ],
  clients: [
    { id: "c1", name: "Mario Rossi", phone: "3331234567", whatsapp: "3331234567" },
    { id: "c2", name: "Anna Bianchi", phone: "3337654321", whatsapp: "3337654321" }
  ],
  appointments: [
    { clientId: "c1", client: "Mario Rossi", service: "Taglio", status: "completed", price: 30 },
    { clientId: "c1", client: "Mario Rossi", service: "Taglio", status: "completed", price: 30 },
    { clientId: "c2", client: "Anna Bianchi", service: "Colore", status: "completed", price: 70 },
    { clientId: "c2", client: "Anna Bianchi", service: "Colore", status: "completed", price: 70 },
    { clientId: "c2", client: "Anna Bianchi", service: "Colore", status: "completed", price: 70 },
    { clientId: "c1", client: "Mario Rossi", service: "Colore", status: "cancelled", price: 70 }
  ]
};

const brief = {
  items: [
    { type: "inactive-client", name: "Mario Rossi", inactiveDays: 90, service: "Taglio" },
    { type: "promotion-expiry", name: "Promo Estate", expiry: "2026-09-05" },
    { type: "weak-time-band", label: "pranzo", band: "midday", appointments: 1, lookbackDays: 60, requiresApproval: true, autoExecute: false },
    { type: "agenda-gap", date: "2026-09-04", start: "15:00", end: "16:00", recommendedService: { name: "Taglio" }, potentialValue: 25 }
  ]
};

test("prepara una bozza di ricontatto senza inviarla", () => {
  const actions = createMaviProactiveActions();
  const result = actions.handle("Ricontatta Mario Rossi", brief, data, "conv");
  assert.equal(result.handled, true);
  assert.equal(result.approvalRequired, true);
  assert.equal(result.execute, false);
  assert.equal(result.proposal.kind, "message-draft");
  assert.equal(result.proposal.recipient, "3331234567");
  assert.match(result.answer, /Non l'ho inviata/);
});

test("prepara un contenuto per una promozione in scadenza", () => {
  const actions = createMaviProactiveActions();
  const result = actions.handle("Preparami il messaggio per la promo", brief, data, "conv");
  assert.equal(result.proposal.kind, "content-draft");
  assert.match(result.proposal.text, /Promo Estate/);
  assert.equal(result.proposal.executable, false);
});

test("trasforma la fascia debole in una bozza promozionale modificabile", () => {
  const actions = createMaviProactiveActions();
  const result = actions.handle("Preparami qualcosa per la fascia pranzo", brief, data, "conv");
  assert.equal(result.handled, true);
  assert.equal(result.proposal.kind, "content-draft");
  assert.equal(result.proposal.sourceType, "weak-time-band");
  assert.equal(result.proposal.targetBand, "pranzo");
  assert.equal(result.proposal.requiresApproval, true);
  assert.equal(result.proposal.executable, false);
  assert.match(result.proposal.text, /pranzo/);
  assert.match(result.answer, /Puoi modificarla/);
});

test("sceglie il servizio con più valore completato e propone un pubblico coerente", () => {
  const actions = createMaviProactiveActions();
  const result = actions.handle("Preparami qualcosa per la fascia pranzo", brief, data, "strategy");
  assert.equal(result.proposal.recommendedService, "Colore");
  assert.equal(result.proposal.recommendedServiceCompleted, 3);
  assert.equal(result.proposal.recommendedServiceValue, 210);
  assert.deepEqual(result.proposal.suggestedAudience, ["Anna Bianchi"]);
  assert.equal(result.proposal.audienceRequiresApproval, true);
  assert.match(result.answer, /Strategia suggerita: Colore/);
  assert.match(result.answer, /qualsiasi ricontatto/);
});

test("non usa appuntamenti cancellati per scegliere la strategia", () => {
  const actions = createMaviProactiveActions();
  const altered = {
    ...data,
    appointments: [
      ...data.appointments,
      { clientId: "c1", client: "Mario Rossi", service: "Taglio", status: "cancelled", price: 1000 }
    ]
  };
  const result = actions.handle("Preparami qualcosa per la fascia pranzo", brief, altered, "cancelled");
  assert.equal(result.proposal.recommendedService, "Colore");
});

test("collega una richiesta al buco in agenda", () => {
  const actions = createMaviProactiveActions();
  const result = actions.handle("Cosa facciamo per il buco in agenda?", brief, data, "conv");
  assert.equal(result.handled, true);
  assert.equal(result.proposal.kind, "agenda-opportunity");
  assert.equal(result.proposal.date, "2026-09-04");
  assert.equal(result.proposal.execute, undefined);
  assert.equal(result.proposal.executable, false);
});

test("un comando di invio non esegue automaticamente", () => {
  const actions = createMaviProactiveActions();
  actions.handle("Ricontatta Mario Rossi", brief, data, "conv");
  const result = actions.handle("invia", brief, data, "conv");
  assert.equal(result.handled, true);
  assert.equal(result.execute, false);
  assert.equal(result.approvalRequired, true);
  assert.match(result.answer, /non esegue invii automatici/i);
});

test("non intercetta richieste estranee", () => {
  const actions = createMaviProactiveActions();
  assert.deepEqual(actions.handle("Quanto costa il taglio?", brief, data, "conv"), { handled: false });
});
