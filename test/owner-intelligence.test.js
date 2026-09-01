import test from "node:test";
import assert from "node:assert/strict";
import { ownerManagerInsight } from "../api/chat-proxy.js";

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
});
