import test from "node:test";
import assert from "node:assert/strict";
import { buildDemandInsight, findWeakTimeBands } from "../lib/mavi-demand-insights.js";
import { buildProactiveBrief } from "../lib/mavi-proactive-manager.js";

const now = "2026-09-04T10:00:00Z";

const body = {
  hours: {
    mon: { start: "09:00", end: "19:00" },
    tue: { start: "09:00", end: "19:00" },
    wed: { start: "09:00", end: "19:00" },
    thu: { start: "09:00", end: "19:00" },
    fri: { start: "09:00", end: "19:00" }
  },
  services: [
    { name: "Taglio", price: 30 },
    { name: "Colore", price: 60 }
  ],
  appointments: [
    { date: "2026-08-10", time: "09:00", service: "Taglio", status: "completed" },
    { date: "2026-08-11", time: "09:30", service: "Taglio", status: "completed" },
    { date: "2026-08-12", time: "10:00", service: "Colore", status: "completed" },
    { date: "2026-08-13", time: "10:30", service: "Taglio", status: "completed" },
    { date: "2026-08-14", time: "11:00", service: "Taglio", status: "completed" },
    { date: "2026-08-17", time: "15:00", service: "Colore", status: "completed" },
    { date: "2026-08-18", time: "15:30", service: "Taglio", status: "completed" },
    { date: "2026-08-19", time: "16:00", service: "Taglio", status: "completed" },
    { date: "2026-08-20", time: "16:30", service: "Taglio", status: "completed" },
    { date: "2026-08-21", time: "17:00", service: "Colore", status: "completed" },
    { date: "2026-08-24", time: "12:30", service: "Taglio", status: "completed" }
  ]
};

test("individua una fascia storicamente debole solo tra gli orari di apertura", () => {
  const rows = findWeakTimeBands(body, { now, lookbackDays: 60, minCompleted: 8, weaknessRatio: 0.6 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].band, "midday");
  assert.equal(rows[0].label, "pranzo");
  assert.equal(rows[0].appointments, 1);
  assert.equal(rows.some(row => row.band === "evening"), false);
});

test("non produce conclusioni con storico insufficiente", () => {
  const sparse = { ...body, appointments: body.appointments.slice(0, 3) };
  assert.deepEqual(findWeakTimeBands(sparse, { now, minCompleted: 8 }), []);
  assert.match(buildDemandInsight(sparse, { now, minCompleted: 8 }).text, /dati sufficienti/);
});

test("genera una spiegazione gestionale senza eseguire azioni", () => {
  const insight = buildDemandInsight(body, { now, lookbackDays: 60, minCompleted: 8 });
  assert.equal(insight.weakest.band, "midday");
  assert.match(insight.text, /promozione o un richiamo mirato/);
  assert.match(insight.text, /conferma del titolare/);
});

test("porta la fascia debole nel brief proattivo con conferma obbligatoria", () => {
  const brief = buildProactiveBrief(body, { now, lookbackDays: 60, minCompleted: 8, maxItems: 10 });
  const item = brief.items.find(row => row.type === "weak-time-band");
  assert.ok(item);
  assert.equal(item.requiresApproval, true);
  assert.equal(item.autoExecute, false);
  assert.match(item.message, /fascia pranzo è debole/);
  assert.equal(brief.weakTimeBands, 1);
});
