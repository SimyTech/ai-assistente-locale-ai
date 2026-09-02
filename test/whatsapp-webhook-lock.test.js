import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  extractWhatsAppMessageId,
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
