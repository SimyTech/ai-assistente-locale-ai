import test from "node:test";
import assert from "node:assert/strict";
import handler, { normalizeFrontendHours } from "../api/chat-proxy.js";

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
