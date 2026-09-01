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

async function call(body, headers = {}) {
  const res = response();
  await handler({ method: "POST", headers, body, socket: { remoteAddress: "203.0.113.20" } }, res);
  return res;
}

function fakeRedis() {
  const values = new Map();
  const counters = new Map();

  return {
    values,
    fetch: async (_url, options) => {
      const [command, ...args] = JSON.parse(options.body);
      let result = null;

      if (command === "GET") result = values.get(args[0]) ?? null;
      if (command === "DEL") result = values.delete(args[0]) ? 1 : 0;
      if (command === "INCR") {
        const next = (counters.get(args[0]) || 0) + 1;
        counters.set(args[0], next);
        result = next;
      }
      if (command === "EXPIRE") result = 1;
      if (command === "EVAL") {
        const key = args[2];
        const token = args[3];
        if (values.get(key) === token) {
          values.delete(key);
          result = 1;
        } else result = 0;
      }
      if (command === "SET") {
        const [key, value, modifier] = args;
        if (modifier === "NX" && values.has(key)) result = null;
        else {
          values.set(key, value);
          result = "OK";
        }
      }

      return { ok: true, json: async () => ({ result }) };
    }
  };
}

const openMonday = { closed: false, open: "09:00", close: "19:00", pauses: [{ from: "13:00", to: "14:00" }] };
const closed = { closed: true, open: "09:00", close: "19:00", pauses: [] };

function dataset() {
  return {
    business: { name: "Salone Test", type: "Parrucchiere" },
    settings: { hours: [openMonday, closed, closed, closed, closed, closed, closed] },
    services: [{ id: "s1", name: "Taglio", duration: 60, price: 30 }],
    promotions: [],
    clients: [],
    appointments: []
  };
}

test("sincronizza, conferma, persiste e recupera una prenotazione", async () => {
  const redis = fakeRedis();
  const originalFetch = globalThis.fetch;
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "redis-token";
  process.env.MAVIRI_OWNER_SYNC_TOKEN = "owner-secret";
  globalThis.fetch = redis.fetch;

  const ownerHeaders = {
    "x-maviri-owner-token": "owner-secret",
    "x-maviri-tenant": "default"
  };
  const clientHeaders = {
    "x-maviri-tenant": "default",
    "x-forwarded-for": "203.0.113.20"
  };

  try {
    const sync = await call({ action: "owner-sync", tenantId: "default", ...dataset() }, ownerHeaders);
    assert.equal(sync.statusCode, 200);
    assert.equal(sync.payload.synced, true);

    const booking = {
      action: "book",
      mode: "client",
      tenantId: "default",
      date: "2026-09-07",
      time: "10:00",
      service: "Taglio",
      name: "Mario Rossi",
      phone: "3331234567"
    };

    const proposal = await call(booking, clientHeaders);
    assert.equal(proposal.statusCode, 200);
    assert.equal(proposal.payload.requiresConfirmation, true);
    assert.equal(proposal.payload.bookingConfirmed, false);

    const confirmed = await call({ ...booking, confirmed: true }, clientHeaders);
    assert.equal(confirmed.statusCode, 200);
    assert.equal(confirmed.payload.bookingConfirmed, true);
    assert.equal(confirmed.payload.persisted, true);
    assert.equal(confirmed.payload.appointment.name, "Mario Rossi");
    const appointmentId = confirmed.payload.appointment.id;

    const duplicate = await call({ ...booking, name: "Luigi Bianchi", phone: "3337654321", confirmed: true }, clientHeaders);
    assert.equal(duplicate.statusCode, 409);
    assert.equal(duplicate.payload.error, "Orario non disponibile.");

    const pull = await call({ action: "owner-pull", tenantId: "default" }, ownerHeaders);
    assert.equal(pull.statusCode, 200);
    assert.equal(pull.payload.data.appointments.length, 1);
    assert.equal(pull.payload.data.clients.length, 1);
    assert.equal(pull.payload.data.appointments[0].clientId, pull.payload.data.clients[0].id);

    const unauthorizedMove = await call({
      action: "update",
      mode: "client",
      tenantId: "default",
      id: appointmentId,
      date: "2026-09-07",
      time: "11:00",
      service: "Taglio",
      name: "Mario Rossi",
      phone: "3330000000"
    }, clientHeaders);
    assert.equal(unauthorizedMove.statusCode, 403);

    const moved = await call({
      action: "update",
      mode: "client",
      tenantId: "default",
      id: appointmentId,
      date: "2026-09-07",
      time: "11:00",
      service: "Taglio",
      name: "Mario Rossi",
      phone: "3331234567"
    }, clientHeaders);
    assert.equal(moved.statusCode, 200);
    assert.equal(moved.payload.persisted, true);
    assert.equal(moved.payload.appointment.time, "11:00");

    const beforeComplete = await call({ action: "owner-pull", tenantId: "default" }, ownerHeaders);
    const ownerData = beforeComplete.payload.data;
    ownerData.appointments[0] = {
      ...ownerData.appointments[0],
      status: "completed",
      completedAt: "2026-09-07T12:00:00.000Z"
    };

    const completionSync = await call({
      action: "owner-sync",
      tenantId: "default",
      business: ownerData.business,
      settings: ownerData.settings,
      services: ownerData.services,
      promotions: ownerData.promotions,
      clients: ownerData.clients,
      appointments: ownerData.appointments
    }, ownerHeaders);
    assert.equal(completionSync.statusCode, 200);
    assert.equal(completionSync.payload.synced, true);

    const afterComplete = await call({ action: "owner-pull", tenantId: "default" }, ownerHeaders);
    assert.equal(afterComplete.payload.data.appointments[0].status, "completed");
    assert.equal(afterComplete.payload.data.appointments[0].completedAt, "2026-09-07T12:00:00.000Z");

    const unauthorizedCancel = await call({
      action: "cancel",
      mode: "client",
      tenantId: "default",
      id: appointmentId,
      phone: "3330000000"
    }, clientHeaders);
    assert.equal(unauthorizedCancel.statusCode, 403);

    const cancelled = await call({
      action: "cancel",
      mode: "client",
      tenantId: "default",
      id: appointmentId,
      phone: "3331234567"
    }, clientHeaders);
    assert.equal(cancelled.statusCode, 200);
    assert.equal(cancelled.payload.persisted, true);

    const afterCancel = await call({ action: "owner-pull", tenantId: "default" }, ownerHeaders);
    assert.equal(afterCancel.payload.data.appointments[0].status, "cancelled");

    const releasedSlot = await call({ ...booking, time: "11:00" }, clientHeaders);
    assert.equal(releasedSlot.statusCode, 200);
    assert.equal(releasedSlot.payload.requiresConfirmation, true);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.MAVIRI_OWNER_SYNC_TOKEN;
  }
});
