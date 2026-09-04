import test from "node:test";
import assert from "node:assert/strict";
import authorizedSendHandler, { validateAuthorizedSendBody } from "../lib/authorized-send-handler.js";
import { proposalActionId } from "../lib/mavi-action-lifecycle.js";

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

function fakeTransport() {
  const store = new Map();
  let deliveries = 0;
  const fetchImpl = async (url, options = {}) => {
    if (url === "https://redis.test") {
      const [command, ...args] = JSON.parse(options.body);
      if (command === "GET") return { ok: true, json: async () => ({ result: store.get(args[0]) ?? null }) };
      if (command === "SET") {
        const [key, value, modifier] = args;
        if (modifier === "NX" && store.has(key)) return { ok: true, json: async () => ({ result: null }) };
        store.set(key, value);
        return { ok: true, json: async () => ({ result: "OK" }) };
      }
      if (command === "EVAL") {
        store.delete(args[2]);
        return { ok: true, json: async () => ({ result: 1 }) };
      }
      throw new Error(`Redis command inatteso: ${command}`);
    }
    if (String(url).includes("graph.facebook.com")) {
      deliveries += 1;
      return { ok: true, json: async () => ({ messages: [{ id: `wamid-${deliveries}` }] }) };
    }
    throw new Error(`URL inatteso: ${url}`);
  };
  return { fetchImpl, deliveryCount: () => deliveries, store };
}

const env = {
  MAVIRI_OWNER_SYNC_TOKEN: "owner-secret",
  UPSTASH_REDIS_REST_URL: "https://redis.test",
  UPSTASH_REDIS_REST_TOKEN: "redis-secret",
  WHATSAPP_ACCESS_TOKEN: "wa-secret",
  WHATSAPP_PHONE_NUMBER_ID: "123456"
};

const proposal = {
  kind: "message-draft",
  channel: "whatsapp",
  recipient: "393331112222",
  text: "Ciao Mario, vuoi fissare un appuntamento?",
  approved: true
};

const actionId = proposalActionId(proposal);

function request(body, token = "owner-secret") {
  return { method: "POST", headers: { "x-maviri-owner-token": token }, body };
}

test("valida action id, coerenza con proposta, approvazione e contenuto", () => {
  assert.equal(validateAuthorizedSendBody({}).ok, false);
  assert.equal(validateAuthorizedSendBody({ actionId: "mavi-action-deadbeef", proposal }).error, "action-id-mismatch");
  assert.equal(validateAuthorizedSendBody({ actionId, proposal: { ...proposal, approved: false } }).error, "approval-required");
  assert.equal(validateAuthorizedSendBody({ actionId, proposal }).ok, true);
});

test("rifiuta un owner non autenticato", async () => {
  const res = responseRecorder();
  const transport = fakeTransport();
  await authorizedSendHandler(request({ actionId, proposal }, "wrong"), res, { env, fetchImpl: transport.fetchImpl });
  assert.equal(res.statusCode, 401);
  assert.equal(transport.deliveryCount(), 0);
});

test("consegna una sola volta lo stesso actionId e persiste il lifecycle completato", async () => {
  const transport = fakeTransport();
  const body = { actionId, proposal };

  const first = responseRecorder();
  await authorizedSendHandler(request(body), first, { env, fetchImpl: transport.fetchImpl });
  assert.equal(first.statusCode, 200);
  assert.equal(first.payload.ok, true);
  assert.equal(first.payload.duplicate, false);
  assert.equal(transport.deliveryCount(), 1);

  const historyRaw = transport.store.get("maviri:action-history");
  assert.ok(historyRaw);
  const history = JSON.parse(historyRaw);
  const persisted = history.actions.find(row => row.id === actionId);
  assert.equal(persisted.status, "completed");

  const second = responseRecorder();
  await authorizedSendHandler(request(body), second, { env, fetchImpl: transport.fetchImpl });
  assert.equal(second.statusCode, 200);
  assert.equal(second.payload.duplicate, true);
  assert.equal(transport.deliveryCount(), 1);
});
