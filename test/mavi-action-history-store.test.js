import test from "node:test";
import assert from "node:assert/strict";
import { createActionLifecycle } from "../lib/mavi-action-lifecycle.js";
import { tenantActionHistoryKey } from "../lib/tenant.js";
import {
  hydrateActionLifecycle,
  loadActionHistorySnapshot,
  persistActionLifecycle,
  saveActionHistorySnapshot
} from "../lib/mavi-action-history-store.js";

const env = {
  UPSTASH_REDIS_REST_URL: "https://redis.example.test",
  UPSTASH_REDIS_REST_TOKEN: "test-token"
};

function withRedisMemory(run) {
  const previousFetch = globalThis.fetch;
  const memory = new Map();
  globalThis.fetch = async (_url, options = {}) => {
    const [command, ...args] = JSON.parse(options.body || "[]");
    if (command === "SET") {
      memory.set(args[0], args[1]);
      return { ok: true, json: async () => ({ result: "OK" }) };
    }
    if (command === "GET") {
      return { ok: true, json: async () => ({ result: memory.get(args[0]) ?? null }) };
    }
    if (command === "DEL") {
      const removed = memory.delete(args[0]) ? 1 : 0;
      return { ok: true, json: async () => ({ result: removed }) };
    }
    throw new Error(`Comando inatteso: ${command}`);
  };
  return Promise.resolve(run(memory)).finally(() => { globalThis.fetch = previousFetch; });
}

const proposal = {
  kind: "message-draft",
  channel: "whatsapp",
  recipientName: "Mario Rossi",
  recipient: "+391234567890",
  sourceType: "inactive-client",
  strategy: "targeted-recontact",
  text: "Ciao Mario, vuoi fissare un nuovo appuntamento?"
};

test("usa chiavi Redis distinte per ogni tenant", () => {
  assert.equal(tenantActionHistoryKey("salone-uno"), "maviri:tenant:salone-uno:action-history");
  assert.equal(tenantActionHistoryKey("salone-due"), "maviri:tenant:salone-due:action-history");
  assert.notEqual(tenantActionHistoryKey("salone-uno"), tenantActionHistoryKey("salone-due"));
  assert.equal(tenantActionHistoryKey("tenant non valido!"), "");
});

test("persiste e ripristina un esito osservato dopo un nuovo processo", async () => withRedisMemory(async () => {
  const first = createActionLifecycle();
  first.approve(proposal, 1000);
  first.requestSend(proposal, 2000);
  first.complete(proposal, 3000);
  first.recordOutcome(proposal, { type: "booked", value: 75, appointmentId: "apt-75" }, 4000);

  await persistActionLifecycle("salone-uno", first, env);

  const second = createActionLifecycle();
  const result = await hydrateActionLifecycle("salone-uno", second, env);
  assert.equal(result.accepted, true);
  assert.equal(result.restored, 1);
  assert.equal(second.get(proposal).outcome, "booked");
  assert.equal(second.get(proposal).outcomeValue, 75);
  assert.equal(second.get(proposal).appointmentId, "apt-75");
}));

test("non mescola lo storico tra due attività", async () => withRedisMemory(async () => {
  const one = createActionLifecycle();
  one.approve(proposal, 1000);
  one.requestSend(proposal, 2000);
  one.complete(proposal, 3000);
  one.recordOutcome(proposal, { type: "booked", value: 50 }, 4000);
  await persistActionLifecycle("salone-uno", one, env);

  const two = createActionLifecycle();
  const result = await hydrateActionLifecycle("salone-due", two, env);
  assert.equal(result.found, false);
  assert.equal(two.list().length, 0);
}));

test("rifiuta tenant non validi invece di usare il tenant default", async () => withRedisMemory(async () => {
  await assert.rejects(
    () => saveActionHistorySnapshot("tenant non valido!", { version: 1, actions: [] }, env),
    /tenant non valido/i
  );
}));

test("se Redis contiene JSON corrotto non altera il lifecycle", async () => withRedisMemory(async memory => {
  memory.set(tenantActionHistoryKey("salone-uno"), "{json-corrotto");
  const lifecycle = createActionLifecycle();
  lifecycle.propose(proposal);
  const loaded = await loadActionHistorySnapshot("salone-uno", env);
  assert.equal(loaded.invalid, true);
  const result = await hydrateActionLifecycle("salone-uno", lifecycle, env);
  assert.equal(result.invalid, true);
  assert.equal(lifecycle.list().length, 1);
}));
