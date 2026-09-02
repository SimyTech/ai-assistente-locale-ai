import test from "node:test";
import assert from "node:assert/strict";
import { buildProactiveBrief, findExpiringPromotions } from "../lib/mavi-proactive-manager.js";

const body = {
  hours: {
    wed: { start: "09:00", end: "18:00", breaks: [{ start: "13:00", end: "14:00" }] },
    thu: { start: "09:00", end: "18:00", breaks: [] }
  },
  services: [
    { name: "Taglio", duration: 30, price: 25 },
    { name: "Colore", duration: 90, price: 70 }
  ],
  clients: [
    { id: "c1", name: "Mario Rossi" }
  ],
  appointments: [
    { id: "a1", clientId: "c1", name: "Mario Rossi", service: "Taglio", date: "2026-05-01", time: "10:00", status: "completed" },
    { id: "a2", clientId: "c1", name: "Mario Rossi", service: "Taglio", date: "2026-09-02", time: "10:00", status: "cancelled" }
  ],
  promotions: [
    { title: "Promo settembre", validUntil: "2026-09-04", active: true }
  ]
};

test("segnala promozioni in scadenza senza eseguire azioni", () => {
  const promos = findExpiringPromotions(body, { now: "2026-09-02" });
  assert.equal(promos.length, 1);
  assert.equal(promos[0].priority, "high");
  assert.equal(promos[0].action, "review-promotion");
});

test("costruisce un brief prioritizzato e non auto-eseguibile", () => {
  const brief = buildProactiveBrief(body, { now: "2026-09-02", maxItems: 3, horizonDays: 2, inactiveDays: 90 });
  assert.equal(brief.hasAttention, true);
  assert.ok(brief.totalItems >= 1);
  assert.ok(brief.items.length <= 3);
  for (const item of brief.items) {
    assert.equal(item.requiresApproval, true);
    assert.equal(item.autoExecute, false);
    assert.ok(item.message);
  }
  assert.match(brief.text, /Mavi ha/);
});

test("limita il brief alle segnalazioni più importanti", () => {
  const brief = buildProactiveBrief(body, { now: "2026-09-02", maxItems: 1, horizonDays: 2 });
  assert.equal(brief.items.length, 1);
  assert.ok(["high", "medium"].includes(brief.items[0].priority));
});

test("non segnala promozioni già scadute o troppo lontane", () => {
  const dataset = {
    ...body,
    promotions: [
      { title: "Scaduta", validUntil: "2026-09-01" },
      { title: "Lontana", validUntil: "2026-10-10" }
    ]
  };
  assert.deepEqual(findExpiringPromotions(dataset, { now: "2026-09-02", promotionHorizonDays: 7 }), []);
});
