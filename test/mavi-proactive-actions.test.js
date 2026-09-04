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
    { id: "c2", name: "Anna Bianchi", phone: "3337654321", whatsapp: "3337654321" },
    { id: "c3", name: "Luca Verdi" }
  ],
  appointments: [
    { clientId: "c1", client: "Mario Rossi", service: "Taglio", status: "completed", price: 30 },
    { clientId: "c1", client: "Mario Rossi", service: "Taglio", status: "completed", price: 30 },
    { clientId: "c2", client: "Anna Bianchi", service: "Colore", status: "completed", price: 70 },
    { clientId: "c2", client: "Anna Bianchi", service: "Colore", status: "completed", price: 70 },
    { clientId: "c2", client: "Anna Bianchi", service: "Colore", status: "completed", price: 70 },
    { clientId: "c3", client: "Luca Verdi", service: "Colore", status: "completed", price: 70 },
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
  assert.equal(result.proposal.recommendedServiceCompleted, 4);
  assert.equal(result.proposal.recommendedServiceValue, 280);
  assert.deepEqual(result.proposal.suggestedAudience, ["Anna Bianchi", "Luca Verdi"]);
  assert.equal(result.proposal.audienceRequiresApproval, true);
  assert.match(result.answer, /Strategia suggerita: Colore/);
  assert.match(result.answer, /qualsiasi ricontatto/);
});

test("esclude dal pubblico chi ha già un appuntamento futuro e privilegia chi è inattivo da più tempo", () => {
  const actions = createMaviProactiveActions();
  const smartData = {
    ...data,
    now: "2026-09-04",
    clients: [
      ...data.clients,
      { id: "c4", name: "Sara Blu", phone: "3330000000", whatsapp: "3330000000" },
      { id: "c5", name: "Paolo Neri", phone: "3331111111", whatsapp: "3331111111", recoveryContactedAt: "2026-08-25" }
    ],
    appointments: [
      ...data.appointments,
      { clientId: "c2", client: "Anna Bianchi", service: "Colore", status: "completed", date: "2026-06-01", price: 70 },
      { clientId: "c2", client: "Anna Bianchi", service: "Colore", status: "confirmed", date: "2026-09-10", price: 70 },
      { clientId: "c4", client: "Sara Blu", service: "Colore", status: "completed", date: "2026-02-01", price: 70 },
      { clientId: "c5", client: "Paolo Neri", service: "Colore", status: "completed", date: "2026-01-01", price: 70 }
    ]
  };
  const result = actions.handle("Prepara WhatsApp per il pubblico della fascia pranzo", brief, smartData, "smart-audience");
  assert.deepEqual(result.proposal.suggestedAudience, ["Sara Blu", "Luca Verdi"]);
  assert.equal(result.proposal.audienceDetails[0].name, "Sara Blu");
  assert.ok(result.proposal.audienceDetails[0].inactiveDays > 200);
  assert.doesNotMatch(result.proposal.suggestedAudience.join(" "), /Anna Bianchi|Paolo Neri/);
  assert.equal(result.proposal.whatsappDrafts[0].recipientName, "Sara Blu");
});

test("prepara bozze WhatsApp tramite la policy centrale e non le rende eseguibili", () => {
  const actions = createMaviProactiveActions();
  const result = actions.handle("Prepara WhatsApp per il pubblico della fascia pranzo", brief, data, "whatsapp");
  assert.equal(result.handled, true);
  assert.equal(result.proposal.whatsappRequiresApproval, true);
  assert.equal(result.proposal.whatsappDrafts.length, 1);
  const draft = result.proposal.whatsappDrafts[0];
  assert.equal(draft.recipientName, "Anna Bianchi");
  assert.equal(draft.recipient, "3337654321");
  assert.equal(draft.channel, "whatsapp");
  assert.equal(draft.messageMode, "mavi_generated");
  assert.equal(draft.approved, false);
  assert.equal(draft.requiresApproval, true);
  assert.equal(draft.executable, false);
  assert.equal(draft.sourceType, "weak-time-band");
  assert.match(draft.text, /Ciao Anna/);
  assert.match(draft.text, /Colore/);
  assert.match(draft.text, /fascia pranzo/);
  assert.doesNotMatch(draft.text, /stiamo cercando di valorizzare|devi|dovresti/i);
  assert.match(result.answer, /bozze WhatsApp pronte: 1/);
});

test("non usa appuntamenti cancellati per scegliere la strategia", () => {
  const actions = createMaviProactiveActions();
  const altered = { ...data, appointments: [...data.appointments, { clientId: "c1", client: "Mario Rossi", service: "Taglio", status: "cancelled", price: 1000 }] };
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
  actions.handle("Prepara WhatsApp per il pubblico della fascia pranzo", brief, data, "conv");
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
