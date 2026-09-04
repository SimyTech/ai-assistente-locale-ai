import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { metaSignatureState, verifyMetaSignature } from "../lib/webhook-signature.js";

test("firma Meta mancante viene classificata come missing", () => {
  const rawBody = Buffer.from(JSON.stringify({ object: "whatsapp_business_account" }));
  assert.equal(metaSignatureState({ secret: "secret", signature: "", rawBody }), "missing");
});

test("firma Meta valida viene accettata", () => {
  const secret = "secret-test";
  const rawBody = Buffer.from(JSON.stringify({ object: "whatsapp_business_account" }));
  const signature = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;

  assert.equal(verifyMetaSignature({ secret, signature, rawBody }), true);
  assert.equal(metaSignatureState({ secret, signature, rawBody }), "valid");
});

test("firma Meta presente ma errata resta invalid", () => {
  const rawBody = Buffer.from(JSON.stringify({ object: "whatsapp_business_account" }));
  const signature = `sha256=${"0".repeat(64)}`;

  assert.equal(metaSignatureState({ secret: "secret-test", signature, rawBody }), "invalid");
});
