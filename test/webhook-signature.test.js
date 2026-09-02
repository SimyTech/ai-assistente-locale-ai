import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  parseJsonBody,
  readRawBody,
  verifyMetaSignature
} from "../lib/webhook-signature.js";

const secret = "meta-app-secret-test";
const rawBody = Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "1" }] }));
const signature = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;

test("accetta una firma Meta calcolata sul corpo grezzo", () => {
  assert.equal(verifyMetaSignature({ secret, signature, rawBody }), true);
});

test("rifiuta firma Meta alterata", () => {
  assert.equal(verifyMetaSignature({ secret, signature: `${signature.slice(0, -1)}0`, rawBody }), false);
});

test("senza App Secret il webhook POST fallisce chiuso", () => {
  assert.equal(verifyMetaSignature({ secret: "", signature: "", rawBody }), false);
  assert.equal(verifyMetaSignature({ secret: "   ", signature, rawBody }), false);
});

test("rifiuta firma mancante anche con App Secret configurato", () => {
  assert.equal(verifyMetaSignature({ secret, signature: "", rawBody }), false);
});

test("legge rawBody senza modificarne i byte", async () => {
  const req = { rawBody };
  const result = await readRawBody(req);
  assert.deepEqual(result, rawBody);
});

test("parsa il JSON solo dopo la verifica", () => {
  const parsed = parseJsonBody(rawBody);
  assert.equal(parsed.object, "whatsapp_business_account");
  assert.equal(parsed.entry[0].id, "1");
});
