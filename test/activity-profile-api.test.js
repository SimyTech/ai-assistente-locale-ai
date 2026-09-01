import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/activity-profile.js";

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

function fakeRedis(seed = {}) {
  const values = new Map(Object.entries(seed));
  const fetch = async (_url, options) => {
    const [command, ...args] = JSON.parse(options.body);
    let result = null;
    if (command === "GET") result = values.has(args[0]) ? values.get(args[0]) : null;
    if (command === "SET") { values.set(args[0], args[1]); result = "OK"; }
    return { ok: true, json: async () => ({ result }) };
  };
  return { values, fetch };
}

async function call(method, body = {}) {
  const res = response();
  await handler({
    method,
    body,
    headers: {
      "x-maviri-tenant": "default",
      "x-maviri-owner-token": "owner-secret"
    }
  }, res);
  return res;
}

test("il setup alimenta business data e contesto pubblico senza perdere agenda e servizi", async () => {
  const originalFetch = globalThis.fetch;
  process.env.MAVIRI_OWNER_SYNC_TOKEN = "owner-secret";
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "redis-token";

  const existing = {
    version: 8,
    revision: 7,
    business: { name: "Vecchio nome" },
    settings: {
      hours: {
        monday: { closed: false, open: "09:00", close: "18:00", pauses: [] }
      }
    },
    services: [{ id: "s1", name: "Consulenza", price: 70 }],
    promotions: [{ id: "p1", title: "Promo" }],
    clients: [{ id: "c1", name: "Mario" }],
    appointments: [{ id: "a1", name: "Mario", date: "2026-09-10", time: "10:00", service: "Consulenza" }]
  };
  const redis = fakeRedis({ "maviri:owner-data": JSON.stringify(existing) });
  globalThis.fetch = redis.fetch;

  try {
    const res = await call("PUT", {
      profile: {
        name: "Studio Rossi",
        sector: "professional",
        workflowMode: "appointment",
        labels: { service: "Prestazione", client: "Cliente", appointment: "Appuntamento" },
        phone: "0523000000",
        whatsapp: "393331234567",
        email: "studio@example.test",
        address: "Via Roma 1",
        description: "Consulenza professionale"
      }
    });

    assert.equal(res.statusCode, 200);
    const data = JSON.parse(redis.values.get("maviri:owner-data"));
    assert.equal(data.business.name, "Studio Rossi");
    assert.equal(data.business.phone, "0523000000");
    assert.equal(data.settings.hours.monday.open, "09:00");
    assert.equal(data.services.length, 1);
    assert.equal(data.clients.length, 1);
    assert.equal(data.appointments.length, 1);

    const publicContext = JSON.parse(redis.values.get("maviri:public-context"));
    assert.equal(publicContext.business.name, "Studio Rossi");
    assert.equal(publicContext.business.address, "Via Roma 1");
    assert.equal(publicContext.services[0].name, "Consulenza");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.MAVIRI_OWNER_SYNC_TOKEN;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  }
});
