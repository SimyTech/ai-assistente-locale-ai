import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMaviLocalContext,
  appendMaviConversation,
  resolveMaviOperationalContext
} from "../lib/mavi-local-context.js";

test("costruisce un contesto locale utile senza dati personali dei clienti", () => {
  const context = buildMaviLocalContext(
    { businessName: "Salone Mavi", businessType: "Parrucchiere" },
    {
      business: { description: "Taglio e colore" },
      services: [
        { name: "Taglio", price: 25, duration: 30 },
        { name: "Colore", price: "45", duration: 60 }
      ],
      promotions: [{ title: "Taglio + piega", price: 35, expires: "2026-09-30" }],
      settings: { hours: { monday: { open: "09:00", close: "18:00" } } },
      clients: [{ name: "Mario Rossi", phone: "+39 333 1234567", notes: "dato privato" }],
      appointments: [{ clientName: "Mario Rossi", phone: "+39 333 1234567" }]
    }
  );

  assert.equal(context.activity.name, "Salone Mavi");
  assert.equal(context.services[0].price, 25);
  assert.equal(context.promotions[0].title, "Taglio + piega");
  assert.equal(context.hours.monday.open, "09:00");
  assert.equal(context.counts.clients, 1);
  assert.equal(context.counts.appointments, 1);
  const serialized = JSON.stringify(context);
  assert.equal(serialized.includes("Mario Rossi"), false);
  assert.equal(serialized.includes("333 1234567"), false);
  assert.equal(serialized.includes("dato privato"), false);
});

test("limita servizi e promozioni per mantenere piccolo il prompt locale", () => {
  const context = buildMaviLocalContext({}, {
    services: Array.from({ length: 18 }, (_, i) => ({ name: `Servizio ${i + 1}` })),
    promotions: Array.from({ length: 12 }, (_, i) => ({ title: `Promo ${i + 1}` }))
  });

  assert.equal(context.services.length, 10);
  assert.equal(context.promotions.length, 6);
  assert.equal(context.counts.services, 18);
  assert.equal(context.counts.promotions, 12);
});

test("mantiene solo una memoria conversazionale breve", () => {
  let history = [];
  for (let i = 1; i <= 6; i += 1) {
    history = appendMaviConversation(history, `domanda ${i}`, `risposta ${i}`, 8);
  }

  assert.equal(history.length, 8);
  assert.deepEqual(history.map(item => item.content), [
    "domanda 3", "risposta 3",
    "domanda 4", "risposta 4",
    "domanda 5", "risposta 5",
    "domanda 6", "risposta 6"
  ]);
});

test("ricompone giorno orario servizio e cliente da messaggi consecutivi", () => {
  const localData = {
    services: [{ name: "Taglio" }, { name: "Colore" }],
    clients: [{ name: "Mario Rossi" }, { name: "Anna Bianchi" }]
  };
  const history = [
    { role: "user", content: "Vorrei prenotare domani" },
    { role: "assistant", content: "A che ora?" },
    { role: "user", content: "Alle 15" },
    { role: "assistant", content: "Quale servizio?" },
    { role: "user", content: "Taglio" },
    { role: "assistant", content: "Per chi?" }
  ];

  const resolved = resolveMaviOperationalContext(history, "Mario Rossi", localData);
  assert.equal(resolved.date, "domani");
  assert.equal(resolved.time, "15:00");
  assert.equal(resolved.service, "Taglio");
  assert.equal(resolved.client, "Mario Rossi");
  assert.match(resolved.enrichedMessage, /Mario Rossi/);
  assert.match(resolved.enrichedMessage, /domani/);
  assert.match(resolved.enrichedMessage, /15:00/);
  assert.match(resolved.enrichedMessage, /Taglio/);
});

test("il dettaglio più recente sostituisce quello precedente", () => {
  const localData = {
    services: [{ name: "Taglio" }, { name: "Colore" }],
    clients: []
  };
  const history = [
    { role: "user", content: "domani alle 15 per Taglio" },
    { role: "assistant", content: "Va bene" },
    { role: "user", content: "anzi dopodomani" },
    { role: "assistant", content: "Ricevuto" }
  ];

  const resolved = resolveMaviOperationalContext(history, "alle 16 per Colore", localData);
  assert.equal(resolved.date, "dopodomani");
  assert.equal(resolved.time, "16:00");
  assert.equal(resolved.service, "Colore");
});

test("non inventa dettagli assenti dalla conversazione", () => {
  const resolved = resolveMaviOperationalContext(
    [{ role: "user", content: "Vorrei prenotare" }],
    "va bene",
    { services: [{ name: "Taglio" }], clients: [{ name: "Mario Rossi" }] }
  );

  assert.equal(resolved.date, "");
  assert.equal(resolved.time, "");
  assert.equal(resolved.service, "");
  assert.equal(resolved.client, "");
});
