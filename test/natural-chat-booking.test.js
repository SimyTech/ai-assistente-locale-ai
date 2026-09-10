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

test("Mavi riconosce un orario espresso in modo naturale nella chat titolare", async () => {
  const res = response();

  await handler({
    method: "POST",
    headers: {},
    body: {
      action: "chat",
      role: "owner",
      message: "Simone, appuntamento taglio uomo per domani verso le 15",
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

test("Mavi usa il contesto per risposte brevi durante una prenotazione", async () => {
  const res = response();
  await handler({
    method: "POST",
    headers: {},
    body: {
      action: "chat", role: "owner", message: "alle 3 e mezza del pomeriggio",
      history: [{ role: "user", content: "vorrei prenotare taglio uomo domani" }],
      settings: { hours: Array.from({ length: 7 }, () => ({ ...openDay })) },
      services: [{ id: "s1", name: "Taglio uomo", duration: 30, price: 20 }], appointments: [], clients: [], promotions: []
    }
  }, res);
  assert.equal(res.payload.booking?.service, "Taglio uomo");
  assert.equal(res.payload.booking?.time, "15:30");
  assert.match(res.payload.answer, /15:30.*disponibile/i);
});

test("Mavi riconosce il giorno del mese senza richiedere mese e anno", async () => {
  const res = response();

  await handler({
    method: "POST",
    headers: {},
    body: {
      action: "chat",
      role: "owner",
      message: "appuntamento taglio uomo il 15 alle 15",
      business: { name: "Attività Test" },
      settings: { hours: Array.from({ length: 7 }, () => ({ ...openDay })) },
      services: [{ id: "s1", name: "Taglio uomo", duration: 30, price: 20 }],
      appointments: [],
      clients: [],
      promotions: []
    }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.match(res.payload.booking?.date || "", /^\d{4}-\d{2}-15$/);
  assert.equal(res.payload.booking?.time, "15:00");
});

test("Mavi riconosce una data relativa espressa in settimane", async () => {
  const res = response();

  await handler({
    method: "POST",
    headers: {},
    body: {
      action: "chat",
      role: "owner",
      message: "appuntamento taglio uomo tra una settimana alle 15",
      business: { name: "Attività Test" },
      settings: { hours: Array.from({ length: 7 }, () => ({ ...openDay })) },
      services: [{ id: "s1", name: "Taglio uomo", duration: 30, price: 20 }],
      appointments: [],
      clients: [],
      promotions: []
    }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.match(res.payload.booking?.date || "", /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(res.payload.booking?.time, "15:00");
});

test("Mavi riconosce anche la prossima settimana nelle richieste di prenotazione", async () => {
  const res = response();
  await handler({
    method: "POST",
    headers: {},
    body: {
      action: "chat", role: "owner", message: "appuntamento taglio uomo la prossima settimana alle 15",
      settings: { hours: Array.from({ length: 7 }, () => ({ ...openDay })) },
      services: [{ id: "s1", name: "Taglio uomo", duration: 30, price: 20 }], appointments: [], clients: [], promotions: []
    }
  }, res);
  assert.match(res.payload.booking?.date || "", /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(res.payload.booking?.time, "15:00");
});

test("Mavi legge l'agenda del titolare per una data esplicita", async () => {
  const res = response();
  await handler({
    method: "POST", headers: {},
    body: {
      action: "chat", role: "owner", message: "agenda il 20/10/2026",
      services: [], clients: [], promotions: [],
      appointments: [{ id: "a1", date: "2026-10-20", time: "10:00", name: "Anna Rossi", service: "Taglio", status: "confirmed" }]
    }
  }, res);
  assert.match(res.payload.answer, /Anna Rossi/);
  assert.match(res.payload.answer, /2026-10-20/);
});

test("Mavi comunica la validità delle promozioni", async () => {
  const res = response();
  await handler({
    method: "POST", headers: {},
    body: { action: "chat", role: "owner", message: "quali promozioni avete?", services: [], appointments: [], clients: [], promotions: [{ title: "Taglio e barba", valid: "Valida fino al 30 settembre" }] }
  }, res);
  assert.match(res.payload.answer, /Taglio e barba/);
  assert.match(res.payload.answer, /Valida fino al 30 settembre/);
});

test("Mavi indica la durata del servizio richiesto", async () => {
  const res = response();
  await handler({
    method: "POST", headers: {},
    body: { action: "chat", role: "owner", message: "quanto dura il taglio uomo?", services: [{ id: "s1", name: "Taglio uomo", duration: 45, price: 25 }], appointments: [], clients: [], promotions: [] }
  }, res);
  assert.match(res.payload.answer, /Taglio uomo dura circa 45 minuti/);
});

test("Mavi calcola il carico della giornata per il titolare", async () => {
  const res = response();
  await handler({
    method: "POST", headers: {},
    body: {
      action: "chat", role: "owner", message: "come sono messo il 01/01/2030?",
      settings: { hours: Array.from({ length: 7 }, () => ({ ...openDay })) },
      services: [{ id: "s1", name: "Taglio", duration: 30, price: 20 }], clients: [], promotions: [],
      appointments: [{ id: "a1", date: "2030-01-01", time: "10:00", serviceId: "s1", service: "Taglio", status: "confirmed" }]
    }
  }, res);
  assert.match(res.payload.answer, /1 appuntamento/);
  assert.match(res.payload.answer, /30 minuti prenotati su 510/);
  assert.match(res.payload.answer, /Occupazione stimata: 6%/);
});

test("Mavi elenca i dettagli degli appuntamenti da confermare", async () => {
  const res = response();
  await handler({
    method: "POST", headers: {},
    body: { action: "chat", role: "owner", message: "quali appuntamenti sono da confermare?", services: [], clients: [], promotions: [], appointments: [{ id: "a1", date: "2030-01-01", time: "10:00", name: "Anna Rossi", service: "Taglio", status: "pending" }] }
  }, res);
  assert.match(res.payload.answer, /Anna Rossi/);
  assert.match(res.payload.answer, /2030-01-01 alle 10:00/);
});

test("Mavi propone gli orari più vicini quando quello richiesto non è libero", async () => {
  const res = response();

  await handler({
    method: "POST",
    headers: {},
    body: {
      action: "chat",
      role: "owner",
      message: "vorrei prenotare taglio uomo il 20/10/2026 alle 15",
      business: { name: "Attività Test" },
      settings: { hours: Array.from({ length: 7 }, () => ({ ...openDay })) },
      services: [{ id: "s1", name: "Taglio uomo", duration: 30, price: 20 }],
      appointments: [{ id: "a1", date: "2026-10-20", time: "15:00", serviceId: "s1", status: "confirmed" }],
      clients: [],
      promotions: []
    }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.match(res.payload.answer, /15:00 non è disponibile/);
  assert.match(res.payload.answer, /14:30, 15:30/);
  assert.equal(res.payload.booking?.status, "choosing-time");
  assert.deepEqual(res.payload.booking?.options, ["14:30", "15:30", "16:00"]);
});

test("Mavi trova il primo posto disponibile senza richiedere una data", async () => {
  const res = response();
  await handler({
    method: "POST", headers: {},
    body: {
      action: "chat", role: "owner", message: "vorrei il primo posto disponibile per taglio uomo",
      settings: { hours: Array.from({ length: 7 }, () => ({ ...openDay })) },
      services: [{ id: "s1", name: "Taglio uomo", duration: 30, price: 20 }], appointments: [], clients: [], promotions: []
    }
  }, res);
  assert.equal(res.payload.booking?.status, "pending");
  assert.equal(res.payload.booking?.service, "Taglio uomo");
  assert.match(res.payload.booking?.date || "", /^\d{4}-\d{2}-\d{2}$/);
  assert.match(res.payload.answer, /primo posto disponibile/i);
});

test("Mavi restituisce orari selezionabili quando manca l'ora", async () => {
  const res = response();
  await handler({
    method: "POST", headers: {},
    body: {
      action: "chat", role: "owner", message: "vorrei prenotare taglio uomo domani",
      settings: { hours: Array.from({ length: 7 }, () => ({ ...openDay })) },
      services: [{ id: "s1", name: "Taglio uomo", duration: 30, price: 20 }], appointments: [], clients: [], promotions: []
    }
  }, res);
  assert.equal(res.payload.booking?.status, "collecting-time");
  assert.ok(res.payload.booking?.options.length > 0);
  assert.match(res.payload.booking.options[0], /^\d{2}:\d{2}$/);
});

test("Mavi trova il primo posto nella data e fascia richieste", async () => {
  const res = response();
  await handler({
    method: "POST", headers: {},
    body: {
      action: "chat", role: "owner", message: "vorrei il primo posto disponibile per taglio uomo domani pomeriggio",
      settings: { hours: Array.from({ length: 7 }, () => ({ ...openDay })) },
      services: [{ id: "s1", name: "Taglio uomo", duration: 30, price: 20 }], appointments: [], clients: [], promotions: []
    }
  }, res);
  assert.equal(res.payload.booking?.status, "pending");
  assert.match(res.payload.answer, /in pomeriggio/i);
  assert.equal(res.payload.booking?.time, "12:00");
});

test("Mavi chiede chiarimento per servizi ambigui e riconosce la variante completa", async () => {
  const data = {
    action: "chat",
    role: "owner",
    settings: { hours: Array.from({ length: 7 }, () => ({ ...openDay })) },
    services: [
      { id: "s1", name: "Taglio uomo", duration: 30, price: 20 },
      { id: "s2", name: "Taglio uomo barba", duration: 60, price: 35 }
    ],
    appointments: [],
    clients: [],
    promotions: []
  };

  const ambiguous = response();
  await handler({ method: "POST", headers: {}, body: { ...data, message: "vorrei prenotare taglio domani" } }, ambiguous);
  assert.match(ambiguous.payload.answer, /Quale servizio vuoi prenotare/);

  const specific = response();
  await handler({ method: "POST", headers: {}, body: { ...data, message: "vorrei prenotare taglio uomo barba domani alle 15" } }, specific);
  assert.equal(specific.payload.booking?.service, "Taglio uomo barba");
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
    { id: "c1", name: "Anna Rossi", notes: "Preferisce appuntamenti al mattino" },
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

test("Mavi analizza servizi più richiesti e clienti con maggior valore", async () => {
  const data = {
    action: "chat", role: "owner",
    clients: [{ id: "c1", name: "Anna Rossi" }, { id: "c2", name: "Luca Bianchi" }],
    services: [{ id: "s1", name: "Taglio", price: 20 }, { id: "s2", name: "Colore", price: 50 }],
    promotions: [],
    appointments: [
      { id: "a1", clientId: "c1", serviceId: "s1", service: "Taglio", date: "2020-01-10", status: "completed" },
      { id: "a2", clientId: "c1", serviceId: "s2", service: "Colore", date: "2020-02-10", status: "completed" },
      { id: "a3", clientId: "c2", serviceId: "s1", service: "Taglio", date: "2020-03-10", status: "completed" }
    ]
  };

  const services = response();
  await handler({ method: "POST", headers: {}, body: { ...data, message: "quali sono i servizi più richiesti?" } }, services);
  assert.match(services.payload.answer, /Taglio: 2 appuntamenti/);

  const clients = response();
  await handler({ method: "POST", headers: {}, body: { ...data, message: "quali sono i clienti più importanti?" } }, clients);
  assert.match(clients.payload.answer, /Anna Rossi — 2 visite, valore stimato €70.00/);
});

test("Mavi suggerisce i servizi da promuovere", async () => {
  const res = response();
  await handler({
    method: "POST", headers: {},
    body: {
      action: "chat", role: "owner", message: "quali servizi devo promuovere?", clients: [], promotions: [],
      services: [{ id: "s1", name: "Taglio" }, { id: "s2", name: "Colore" }, { id: "s3", name: "Trattamento" }],
      appointments: [{ id: "a1", serviceId: "s1", service: "Taglio", status: "completed" }]
    }
  }, res);
  assert.match(res.payload.answer, /Colore: 0 appuntamenti/);
  assert.match(res.payload.answer, /Trattamento: 0 appuntamenti/);
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

test("Mavi mostra la scheda operativa del cliente richiesto dal titolare", async () => {
  const res = response();
  await handler({ method: "POST", headers: {}, body: { ...customerDataset, message: "quando torna Anna?" } }, res);

  assert.equal(res.statusCode, 200);
  assert.match(res.payload.answer, /Scheda di Anna Rossi/);
  assert.match(res.payload.answer, /3 appuntamenti completati/);
  assert.match(res.payload.answer, /2026-08-20/);
  assert.match(res.payload.answer, /Prossimo: non fissato/);
  assert.match(res.payload.answer, /Preferisce appuntamenti al mattino/);
});

test("Mavi riepiloga le priorità operative del titolare", async () => {
  const res = response();
  await handler({
    method: "POST",
    headers: {},
    body: {
      action: "chat",
      role: "owner",
      message: "quali sono le priorità di oggi?",
      clients: [],
      services: [],
      promotions: [],
      appointments: [{ id: "a1", date: "2030-01-01", status: "pending" }]
    }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.match(res.payload.answer, /Priorità operative/);
  assert.match(res.payload.answer, /1 appuntamento da confermare/);
});

test("Mavi indica il prossimo appuntamento al titolare", async () => {
  const res = response();
  await handler({
    method: "POST", headers: {},
    body: {
      action: "chat", role: "owner", message: "qual è il prossimo appuntamento?", services: [], clients: [], promotions: [],
      appointments: [
        { id: "a2", date: "2030-01-02", time: "11:00", name: "Luca Bianchi", service: "Barba", status: "confirmed" },
        { id: "a1", date: "2030-01-01", time: "10:00", name: "Anna Rossi", service: "Taglio", status: "confirmed" }
      ]
    }
  }, res);
  assert.match(res.payload.answer, /2030-01-01 alle 10:00/);
  assert.match(res.payload.answer, /Anna Rossi/);
});
