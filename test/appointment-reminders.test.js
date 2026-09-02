import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_RULES,
  markReminderSent,
  planAppointmentReminders,
  pruneReminderState,
  reminderKey,
  reminderMessage,
  romeLocalNow
} from "../lib/appointment-reminders.js";

test("romeLocalNow converte l'istante nell'orario locale di Roma", () => {
  const value = romeLocalNow(new Date("2026-09-02T10:00:00.000Z"));
  assert.deepEqual(value, { date: "2026-09-02", time: "12:00" });
});

test("pianifica il promemoria del giorno prima", () => {
  const appointment = {
    id: "a1",
    date: "2026-09-03",
    time: "12:00",
    service: "Taglio",
    whatsapp: "393331234567",
    status: "confirmed"
  };
  const result = planAppointmentReminders({
    appointments: [appointment],
    now: new Date("2026-09-02T10:00:00.000Z")
  });
  assert.equal(result.due.length, 1);
  assert.equal(result.due[0].ruleId, "day-before");
  assert.equal(result.due[0].recipient, "393331234567");
  assert.match(result.due[0].message, /Taglio/);
});

test("pianifica il promemoria imminente due ore prima", () => {
  const result = planAppointmentReminders({
    appointments: [{
      id: "a2",
      date: "2026-09-02",
      time: "14:00",
      service: "Piega",
      phone: "390000000001",
      status: "confirmed"
    }],
    now: new Date("2026-09-02T10:00:00.000Z")
  });
  assert.equal(result.due.length, 1);
  assert.equal(result.due[0].ruleId, "imminent");
  assert.match(result.due[0].message, /oggi alle 14:00/);
});

test("non ripropone un promemoria già inviato", () => {
  const appointment = {
    id: "a3",
    date: "2026-09-03",
    time: "12:00",
    service: "Colore",
    whatsapp: "390000000002",
    status: "confirmed"
  };
  const key = reminderKey(appointment, "day-before");
  const state = { sent: { [key]: { sentAt: "2026-09-02T09:59:00.000Z" } } };
  const result = planAppointmentReminders({
    appointments: [appointment],
    state,
    now: new Date("2026-09-02T10:00:00.000Z")
  });
  assert.deepEqual(result.due, []);
});

test("ignora appuntamenti annullati, passati o senza recapito", () => {
  const result = planAppointmentReminders({
    appointments: [
      { id: "x1", date: "2026-09-03", time: "12:00", status: "cancelled", whatsapp: "1" },
      { id: "x2", date: "2026-09-01", time: "12:00", status: "confirmed", whatsapp: "2" },
      { id: "x3", date: "2026-09-03", time: "12:00", status: "confirmed" }
    ],
    now: new Date("2026-09-02T10:00:00.000Z")
  });
  assert.deepEqual(result.due, []);
});

test("markReminderSent rende idempotente lo stato", () => {
  const reminder = { key: "a|2026-09-03|12:00|day-before", ruleId: "day-before", appointmentId: "a" };
  const next = markReminderSent({}, reminder, "2026-09-02T10:01:00.000Z");
  assert.deepEqual(next.sent[reminder.key], {
    sentAt: "2026-09-02T10:01:00.000Z",
    ruleId: "day-before",
    appointmentId: "a"
  });
});

test("pruneReminderState elimina dedupe obsoleti dopo spostamento o annullamento", () => {
  const state = {
    sent: {
      "a|2026-09-03|12:00|day-before": { sentAt: "x" },
      "b|2026-09-03|13:00|day-before": { sentAt: "x" }
    }
  };
  const next = pruneReminderState(state, [
    { id: "a", date: "2026-09-04", time: "12:00", status: "confirmed" },
    { id: "b", date: "2026-09-03", time: "13:00", status: "confirmed" }
  ]);
  assert.deepEqual(Object.keys(next.sent), ["b|2026-09-03|13:00|day-before"]);
});

test("le regole di default includono giorno prima e imminente", () => {
  assert.deepEqual(DEFAULT_RULES.map(rule => rule.id), ["day-before", "imminent"]);
  assert.match(reminderMessage({ service: "Taglio", date: "2026-09-03", time: "10:00" }, "day-before"), /2026-09-03/);
});
