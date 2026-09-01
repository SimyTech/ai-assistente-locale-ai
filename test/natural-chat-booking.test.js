import test from "node:test";
import assert from "node:assert/strict";
import handler, { normalizeFrontendHours } from "../api/chat-proxy.js";
import chatEntryHandler, { normalizeExplicitDateTimeMessage } from "../api/chat-entry.js";

function response() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

const openDay = {
  closed: false,
  open: "09:00",
  close: "19:00",
  pauses: [{ from: "13:00", to: "14:30" }]
};

test("normalizza gli orari frontend anche per la chat del titolare", () => {
  const body = normalizeFrontendHours({
    action: "chat",
    settings: { hours: Array.from({ length: 7 }, () => ({ ...openDay })) }
  });

  assert.equal(Array.isArray(body.settings.hours), false);
  assert.equal(body.settings.hours.monday.open, "09:00");
  assert.equal(body.settings.hours.wednesday.close, "19:00");
});

test("Mavi riconosce domani ore 15 come slot libero nella chat titolare", async () => {
  const res = response();

  await handler({
    method: "POST",
    headers: {},
    body: {
      action: "chat",
      role: "owner",
      message: "Simone, appuntamento taglio uomo per domani ore 15",
      business: { name: "Attività Test" },
      settings: { hours: Array.from({ length: 7 }, () => ({ ...openDay })) },
      services: [{ id: "s1", name: "Taglio uomo", duration: 30, price: 20 }],
      appointments: [],
      clients: [],
      promotions: []
    }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.doesNotMatch(res.payload.answer, /non risultano orari disponibili/i);
  assert.match(res.payload.answer, /15:00.*disponibile/i);
  assert.equal(res.payload.booking?.time, "15:00");
  assert.equal(res.payload.booking?.service, "Taglio uomo");
});

test("normalizza data esplicita senza scambiare il giorno per l'orario", () => {
  const cases = [
    ["appuntamento il 02/09/2026 ore 15", "ore 15:00"],
    ["appuntamento il 02/09/2026 alle 15:30", "ore 15:30"],
    ["appuntamento 02-09-2026 h 9", "ore 09:00"]
  ];

  for (const [message, expectedPrefix] of cases) {
    const normalized = normalizeExplicitDateTimeMessage({ action: "chat", message });
    assert.match(normalized.message, new RegExp(`^${expectedPrefix}`));
    assert.match(normalized.message, /02[\/-]09[\/-]2026/);
  }
});

test("Mavi usa l'orario dopo 'ore' quando la richiesta contiene una data esplicita", async () => {
  const res = response();

  await chatEntryHandler({
    method: "POST",
    headers: {},
    body: {
      action: "chat",
      role: "owner",
      message: "Simone, appuntamento taglio uomo il 07/09/2026 ore 15",
      business: { name: "Attività Test" },
      settings: { hours: Array.from({ length: 7 }, () => ({ ...openDay })) },
      services: [{ id: "s1", name: "Taglio uomo", duration: 30, price: 20 }],
      appointments: [],
      clients: [],
      promotions: []
    }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.booking?.date, "2026-09-07");
  assert.equal(res.payload.booking?.time, "15:00");
});

const customerDataset = {
  action: "chat",
  role: "owner",
  clients: [
    { id: "c1", name: "Anna Rossi" },
    { id: "c2", name: "Luca Bianchi" },
    { id: "c3", name: "Marco Verdi" }
  ],
  appointments: [
    { id: "a1", clientId: "c1", name: "Anna Rossi", date: "2026-08-20", status: "completed" },
    { id: "a2", clientId: "c1", name: "Anna Rossi", date: "2026-07-20", status: "completed" },
    { id: "a3", clientId: "c1", name: "Anna Rossi", date: "2026-06-20", status: "completed" },
    { id: "a4", clientId: "c2", name: "Luca Bianchi", date: "2026-05-01", status: "completed" },
    { id: "a5", clientId: "c3", name: "Marco Verdi", date: "2026-09-10", status: "confirmed" }
  ]
};

test("Mavi individua i clienti abituali dallo storico appuntamenti", async () => {
  const res = response();
  await handler({ method: "POST", headers: {}, body: { ...customerDataset, message: "quali clienti sono abituali?" } }, res);

  assert.equal(res.statusCode, 200);
  assert.match(res.payload.answer, /Anna Rossi/);
  assert.match(res.payload.answer, /3 visite/);
  assert.doesNotMatch(res.payload.answer, /Posso aiutarti con servizi/);
});

test("Mavi individua i clienti che non vengono da un po", async () => {
  const res = response();
  await handler({ method: "POST", headers: {}, body: { ...customerDataset, message: "quali clienti non vengono da un po?" } }, res);

  assert.equal(res.statusCode, 200);
  assert.match(res.payload.answer, /Luca Bianchi/);
  assert.match(res.payload.answer, /2026-05-01/);
  assert.doesNotMatch(res.payload.answer, /Marco Verdi/);
  assert.doesNotMatch(res.payload.answer, /Posso aiutarti con servizi/);
});
