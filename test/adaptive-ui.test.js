import test from "node:test";
import assert from "node:assert/strict";
import { adaptiveDashboardPlan } from "../lib/adaptive-ui.js";

test("un'attività su appuntamento mette il calendario in primo piano", () => {
  const plan = adaptiveDashboardPlan({
    name: "Studio Rossi",
    workflowMode: "appointment",
    labels: { service: "Prestazione", client: "Cliente", appointment: "Appuntamento" },
    capabilities: { appointments: true, clients: true, services: true }
  });
  assert.equal(plan.order[1], "calendar");
  assert.equal(plan.visible.calendar, true);
  assert.equal(plan.labels.appointments, "Appuntamenti");
  assert.equal(plan.primaryAction, "Nuovo appuntamento");
});

test("un negozio senza agenda non mostra il calendario", () => {
  const plan = adaptiveDashboardPlan({
    name: "Bottega Verde",
    workflowMode: "none",
    labels: { service: "Servizio/prodotto", client: "Cliente", appointment: "Prenotazione" },
    capabilities: { appointments: false, clients: true, services: true }
  });
  assert.equal(plan.visible.calendar, false);
  assert.equal(plan.order[1], "mavi");
  assert.equal(plan.labels.services, "Servizi/prodotti");
});

test("usa correttamente termini personalizzati di settori diversi", () => {
  const health = adaptiveDashboardPlan({
    workflowMode: "appointment",
    labels: { service: "Prestazione", client: "Paziente", appointment: "Visita" }
  });
  assert.equal(health.labels.clients, "Pazienti");
  assert.equal(health.labels.appointments, "Visite");
  assert.equal(health.primaryAction, "Nuova visita");

  const fitness = adaptiveDashboardPlan({
    workflowMode: "mixed",
    labels: { service: "Lezione/servizio", client: "Socio", appointment: "Prenotazione" }
  });
  assert.equal(fitness.labels.services, "Lezioni/servizi");
  assert.equal(fitness.labels.clients, "Soci");
  assert.equal(fitness.labels.appointments, "Prenotazioni");
  assert.equal(fitness.primaryAction, "Nuova prenotazione");
});

test("le capability possono togliere moduli non utili senza dipendere dal settore", () => {
  const plan = adaptiveDashboardPlan({
    sector: "generic",
    workflowMode: "mixed",
    capabilities: { appointments: true, clients: false, services: false, promotions: false, content: false }
  });
  assert.equal(plan.visible.calendar, true);
  assert.equal(plan.visible.clients, false);
  assert.equal(plan.visible.services, false);
  assert.equal(plan.visible.promotions, false);
  assert.equal(plan.visible.content, false);
  assert.equal(plan.primaryAction, "Nuova prenotazione");
});
