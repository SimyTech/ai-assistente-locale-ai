import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Readable } from "node:stream";
import { readRawBody, verifySignature } from "../api/whatsapp.js";

test("readRawBody preserves the exact webhook bytes", async () => {
  const payload = Buffer.from('{"object":"whatsapp_business_account","entry":[]}');
  const request = Readable.from([payload.subarray(0, 12), payload.subarray(12)]);
  const rawBody = await readRawBody(request);

  assert.deepEqual(rawBody, payload);
});

test("verifySignature accepts the Meta signature for the exact raw body", () => {
  const previousSecret = process.env.WHATSAPP_APP_SECRET;
  process.env.WHATSAPP_APP_SECRET = "test-app-secret";

  try {
    const rawBody = Buffer.from('{"field":"messages","value":{"text":"ciao"}}');
    const signature = `sha256=${createHmac("sha256", process.env.WHATSAPP_APP_SECRET).update(rawBody).digest("hex")}`;
    const request = { headers: { "x-hub-signature-256": signature } };

    assert.equal(verifySignature(request, rawBody), true);
  } finally {
    if (previousSecret === undefined) delete process.env.WHATSAPP_APP_SECRET;
    else process.env.WHATSAPP_APP_SECRET = previousSecret;
  }
});

test("verifySignature rejects a payload changed after signing", () => {
  const previousSecret = process.env.WHATSAPP_APP_SECRET;
  process.env.WHATSAPP_APP_SECRET = "test-app-secret";

  try {
    const signedBody = Buffer.from('{"field":"messages","value":{"text":"ciao"}}');
    const changedBody = Buffer.from('{"field":"messages","value":{"text":"ciao!"}}');
    const signature = `sha256=${createHmac("sha256", process.env.WHATSAPP_APP_SECRET).update(signedBody).digest("hex")}`;
    const request = { headers: { "x-hub-signature-256": signature } };

    assert.equal(verifySignature(request, changedBody), false);
  } finally {
    if (previousSecret === undefined) delete process.env.WHATSAPP_APP_SECRET;
    else process.env.WHATSAPP_APP_SECRET = previousSecret;
  }
});
