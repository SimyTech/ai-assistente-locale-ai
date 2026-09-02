import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  acquireWhatsAppWebhookLock,
  extractWhatsAppMessageId,
  releaseWhatsAppWebhookLock,
  whatsappWebhookLockKey
} from "../lib/whatsapp-webhook-lock.js";

test("estrae il message id dal payload Meta", () => {
  const body = {
    entry: [{ changes: [{ value: { messages: [{ id: "wamid.abc", type: "text" }] } }] }]
  };
  assert.equal(extractWhatsAppMessageId(body), "wamid.abc");
  assert.equal(extractWhatsAppMessageId({ entry: [] }), "");
});

test("il lock è isolato per tenant e message id", () => {
  assert.equal(
    whatsappWebhookLockKey("salone-rosa", "wamid.abc"),
    "maviri:whatsapp:inflight:salone-rosa:wamid.abc"
  );
  assert.notEqual(
    whatsappWebhookLockKey("salone-rosa", "wamid.abc"),
    whatsappWebhookLockKey("studio-verdi", "wamid.abc")
  );
});

test("acquisisce il lock con un token univoco e lo rilascia solo se ne è proprietario", async () => {
  const originalFetch = globalThis.fetch;
  const commands = [];
  globalThis.fetch = async (_url, options) => {
    const command = JSON.parse(options.body);
    commands.push(command);
    return {
      ok: true,
      json: async () => ({ result: command[0] === "SET" ? "OK" : 1 })
    };
  };

  try {
    const env = { UPSTASH_REDIS_REST_URL: "https://redis.test", UPSTASH_REDIS_REST_TOKEN: "token" };
    const lock = await acquireWhatsAppWebhookLock({ tenantId: "salone-rosa", messageId: "wamid.abc" }, env);
    assert.equal(lock.acquired, true);
    assert.ok(lock.token);
    assert.deepEqual(commands[0].slice(0, 3), ["SET", lock.key, lock.token]);
    assert.deepEqual(commands[0].slice(3), ["NX", "PX", "30000"]);

    assert.equal(await releaseWhatsAppWebhookLock(lock, env), true);
    assert.equal(commands[1][0], "EVAL");
    assert.equal(commands[1][2], "1");
    assert.equal(commands[1][3], lock.key);
    assert.equal(commands[1][4], lock.token);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("non tenta di rilasciare un lock senza token proprietario", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; };
  try {
    assert.equal(await releaseWhatsAppWebhookLock({ key: "lock", token: "" }), false);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("il proxy acquisisce il lock dopo firma e routing ma prima dei guard", async () => {
  const proxy = await readFile(new URL("../api/whatsapp-proxy.js", import.meta.url), "utf8");
  const signature = proxy.indexOf("const valid = verifyMetaSignature");
  const routing = proxy.indexOf("const route = whatsappTenantRoute");
  const lock = proxy.indexOf("lock = await acquireWhatsAppWebhookLock");
  const reschedule = proxy.indexOf("handleSafeReschedule(req, res)", lock);
  const cancellation = proxy.indexOf("handleSafeCancellation(req, res)", lock);
  assert.ok(signature >= 0);
  assert.ok(routing > signature);
  assert.ok(lock > routing);
  assert.ok(reschedule > lock);
  assert.ok(cancellation > lock);
  assert.match(proxy, /finally\s*\{[\s\S]*releaseWhatsAppWebhookLock/);
  assert.match(proxy, /duplicate:\s*true,[\s\S]*inProgress:\s*true/);
});
