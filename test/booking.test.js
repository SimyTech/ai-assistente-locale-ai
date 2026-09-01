import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/chat.js";

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

const openDay = { closed: false, open: "09:00", close: "19:00", pauses: [{ from: "13:00", to: "14:00" }] };
const closedDay = { closed: true, open: "09:00", close: "19:00", pauses: [] };

function ownerBody(extra = {}) {
  return {
    action: "book",
    mode: "owner",
    tenantId: "default",
    date: "2026-09-07",
    time: "10:00",
    service: "Taglio",
    name: "Mario Rossi",
    phone: "3331234567",
    services: [{ id: "s1", name: "Taglio", duration: 60, price: 30 }],
    appointments: [],
    clients: [],
    settings: { hours: [openDay, closedDay, closedDay, closedDay, closedDay, closedDay, closedDay] },
    ...extra
  };
}

async function call(body) {
  process.env.MAVIRI_OWNER_SYNC_TOKEN = "test-secret";
  const res = response();
  await handler({
    method: "POST",
    headers: { "x-maviri-owner-token": "test-secret", "x-maviri-tenant": "default" },
    body
  }, res);
  return res;
}

test("converte gli orari frontend e propone la conferma solo per uno slot libero", async () => {
  const res = await call(ownerBody());
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.requiresConfirmation, true);
  assert.equal(res.payload.bookingConfirmed, false);
  assert.equal(res.payload.appointment.time, "10:00");
});

test("rifiuta una prenotazione che attraversa la pausa", async () => {
  const res = await call(ownerBody({ time: "12:30" }));
  assert.equal(res.statusCode, 409);
  assert.equal(res.payload.error, "Orario non disponibile.");
});

test("rifiuta una sovrapposizione prima di chiedere conferma", async () => {
  const res = await call(ownerBody({
    time: "10:30",
    appointments: [{ id: "a1", date: "2026-09-07", time: "10:00", service: "Taglio", status: "confirmed" }]
  }));
  assert.equal(res.statusCode, 409);
  assert.equal(res.payload.bookingConfirmed, false);
});

test("disponibilità owner usa lo stesso formato orari del frontend", async () => {
  const res = await call({ ...ownerBody(), action: "availability" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.available, true);
  assert.ok(res.payload.slots.includes("10:00"));
  assert.equal(res.payload.slots.includes("13:00"), false);
});
