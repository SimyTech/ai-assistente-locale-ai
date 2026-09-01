import test from "node:test";
import assert from "node:assert/strict";
import { clientAddress, rateLimitKey, rateLimitPolicy } from "../lib/rate-limit.js";

test("estrae solo il primo IP inoltrato", () => {
  assert.equal(clientAddress({ headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" } }), "203.0.113.9");
});

test("non inserisce l'indirizzo IP in chiaro nella chiave Redis", () => {
  const key = rateLimitKey({ tenantId: "salone-uno", action: "book", identity: "203.0.113.9" });
  assert.match(key, /^maviri:tenant:salone-uno:rate:book:[a-f0-9]{24}$/);
  assert.equal(key.includes("203.0.113.9"), false);
});

test("applica limiti più severi alle prenotazioni", () => {
  assert.ok(rateLimitPolicy("book").limit < rateLimitPolicy("availability").limit);
  assert.equal(rateLimitPolicy("unknown"), null);
});
