import test from "node:test";
import assert from "node:assert/strict";
import { buildCancellationStats, buildRevenueStats, buildServicePerformance, ownerManagerInsight } from "../api/chat-proxy.js";

const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Rome",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
}).format(new Date());

function addDays(iso, amount) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}

const dataset = {
  action: "chat",
  role: "owner",
  business: { name: "Studio Test" },
  activityProfile: {
    labels: { client: "Paziente", appointment: "Visita", service: "Prestazione" }
  },
  services: [
    { name: "Controllo", price: 50 },
    { name: "Trattamento", price: 90 }
  ],
  clients: [
    { id: "c1", name: "Anna Rossi" },
    { id: "c2", name: "Luca Bianchi" },
    { id: "c3", name: "Marco Verdi" },
    { id: "c4", name: "Sara Neri" }
  ],
  appointments: [
    { id: "a1", clientId: "c1", name: "Anna Rossi", service: "Trattamento", date: addDays(today, -10), status: "completed" },
    { id: "a2", clientId: "c1", name: "Anna Rossi", service: "Trattamento", date: addDays(today, -40), status: "completed" },
    { id: "a3", clientId: "c2", name: "Luca Bianchi", service: "Controllo", date: addDays(today, -90), status: "completed" },
    { id: "a4", clientId: "c3", name: "Marco Verdi", service: "Controllo", date: today, time: "15:00", status: "confirmed" },
    { id: "a5", clientId: "c3", name: "Marco Verdi", service: "Controllo", date: addDays(today, 1), time: "10:00", status: "confirmed" }
    ,{ id: "a6", clientId: "c2", name: "Luca Bianchi", service: "Controllo", date: addDays(today, -5), time: "09:00", status: "no_show", noShowAt: `${addDays(today, -5)}T09:30:00.000Z` }
    ,{ id: "a7", clientId: "c1", name: "Anna Rossi", service: "Trattamento", date: addDays(today, 1), time: "11:00", status: "confirmed", reminderSentAt: `${today}T10:00:00.000Z` }
  ]
};

function ask(message) {
  return ownerManagerInsight({ ...dataset, message });
}

test("usa anche il linguaggio del profilo attività", () => {
  assert.match(ask("quali pazienti sono abituali?"), /pazienti/i);
  assert.match(ask("quali pazienti sono abituali?"), /Anna Rossi/);
});

test("individua clienti a rischio di abbandono", () => {
  const answer = ask("quali pazienti non tornano da un po?");
  assert.match(answer, /Luca Bianchi/);
  assert.doesNotMatch(answer, /Marco Verdi/);
});

test("non propone clienti già ricontattati o con un prossimo appuntamento", () => {
  const contacted = ownerManagerInsight({
    ...dataset,
    clients: dataset.clients.map(client => client.id === "c2" ? { ...client, recoveryContactedAt: new Date().toISOString() } : client),
    message: "quali pazienti devo ricontattare e recuperare?"
  });
  assert.doesNotMatch(contacted, /Luca Bianchi/);

  const booked = ownerManagerInsight({
    ...dataset,
    appointments: [...dataset.appointments, { id: "a8", clientId: "c2", name: "Luca Bianchi", date: addDays(today, 5), time: "12:00", status: "confirmed" }],
    message: "quali pazienti devo ricontattare e recuperare?"
  });
  assert.doesNotMatch(booked, /Luca Bianchi/);
});

test("classifica i migliori clienti usando valore e frequenza", () => {
  const answer = ask("chi sono i miei migliori pazienti?");
  assert.match(answer, /Anna Rossi/);
  assert.match(answer, /€180\.00/);
});

test("elenca appuntamenti di oggi e domani", () => {
  assert.match(ask("che visite ho oggi?"), /15:00.*Marco Verdi/);
  assert.match(ask("che visite ho domani?"), /10:00.*Marco Verdi/);
});

test("conta clienti e segnala quelli senza visite", () => {
  assert.match(ask("quanti pazienti ho?"), /4 pazienti/i);
  assert.match(ask("quali pazienti non sono mai venuti?"), /Sara Neri/);
});

test("produce un riepilogo operativo dell'attività", () => {
  const answer = ask("fammi un riepilogo della situazione");
  assert.match(answer, /Riepilogo Studio Test/);
  assert.match(answer, /Visite oggi: 1/);
  assert.match(answer, /Pazienti da recuperare/i);
  assert.match(answer, /Assenze\/no-show registrati: 1/);
  assert.match(answer, /Promemoria da inviare per domani: 1/);
});

test("elenca no-show senza contarli come visite o valore cliente", () => {
  const answer = ask("quali pazienti sono stati assenti o no-show?");
  assert.match(answer, /Luca Bianchi/);
  const best = ask("chi sono i miei migliori pazienti?");
  assert.match(best, /Luca Bianchi — 1 visite, valore stimato €50\.00/);
});

test("indica solo i promemoria di domani non ancora inviati", () => {
  const answer = ask("quali promemoria devo inviare domani?");
  assert.match(answer, /Marco Verdi/);
  assert.doesNotMatch(answer, /Anna Rossi/);
});

test("riassume le azioni operative pendenti", () => {
  const answer = ask("cosa devo gestire oggi?");
  assert.match(answer, /Azioni operative pendenti/);
  assert.match(answer, /Promemoria da inviare per domani: 1/);
});

test("classifica i clienti per rischio no-show e valore perso", () => {
  const answer = ask("quali pazienti hanno più assenze e sono meno affidabili?");
  assert.match(answer, /Pazienti con più assenze\/no-show/);
  assert.match(answer, /Luca Bianchi — 1 assenza, valore stimato perso €50\.00/);
});


test("calcola il valore economico senza contare annullati e no-show", () => {
  const stats = buildRevenueStats(dataset);
  assert.equal(typeof stats.todayScheduled, "number");
  assert.ok(stats.monthCompleted >= 0);
  assert.ok(stats.monthScheduled >= stats.monthCompleted);
});

test("Mavi risponde alle domande sugli incassi con una stima trasparente", () => {
  const answer = ask("quanto ho incassato questo mese?");
  assert.match(answer, /Prestazioni completate questo mese: €\d+\.\d{2}/);
  assert.match(answer, /non sostituisce la contabilità fiscale/);
});


test("classifica i servizi per valore completato e quantifica le perdite", () => {
  const rows = buildServicePerformance(dataset);
  assert.equal(rows[0].name, "Trattamento");
  assert.ok(rows[0].completedValue > 0);
  assert.equal(rows.find(row => row.noShows > 0)?.lostValue, 50);
});

test("Mavi confronta i servizi e calcola il valore perso per no-show", () => {
  assert.match(ask("quali servizi rendono di più?"), /Servizi per valore generato/);
  const lost = ask("quanto ho perso per i no-show?");
  assert.match(lost, /Valore stimato perso.*€50\.00/);
  assert.match(lost, /Controllo.*€50\.00 persi/);
});


test("raggruppa i motivi di annullamento e il loro valore", () => {
  const input = { ...dataset, appointments: [...dataset.appointments,
    { service: "Controllo", status: "cancelled", cancellationReason: "Cliente indisponibile" },
    { service: "Trattamento", status: "cancelled", cancellationReason: "Cliente indisponibile" }
  ] };
  const stats = buildCancellationStats(input);
  assert.equal(stats.total, 2);
  assert.equal(stats.lostValue, 140);
  assert.deepEqual(stats.reasons[0], { reason: "Cliente indisponibile", count: 2 });
  assert.match(ownerManagerInsight({ ...input, message: "perché vengono annullati gli appuntamenti?" }), /Valore potenziale annullato: €140\.00/);
});
