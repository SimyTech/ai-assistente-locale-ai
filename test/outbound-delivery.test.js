import test from "node:test";
import assert from "node:assert/strict";
import {
  deliverAuthorizedProposal,
  emailDeliveryConfigured,
  sendEmailText,
  sendWhatsAppText,
  whatsappDeliveryConfigured
} from "../lib/outbound-delivery.js";

const whatsappEnv = {
  WHATSAPP_ACCESS_TOKEN: "token-test",
  WHATSAPP_PHONE_NUMBER_ID: "123456",
  MAVIRI_WHATSAPP_PROACTIVE: "true"
};

const emailEnv = {
  RESEND_API_KEY: "resend-test",
  MAVIRI_EMAIL_FROM: "Maviri <noreply@example.com>"
};

test("riconosce configurazione WhatsApp ed email senza esporre segreti", () => {
  assert.equal(whatsappDeliveryConfigured("default", whatsappEnv), true);
  assert.equal(whatsappDeliveryConfigured("default", {}), false);
  assert.equal(emailDeliveryConfigured(emailEnv), true);
  assert.equal(emailDeliveryConfigured({}), false);
});

test("WhatsApp usa il sender del tenant e restituisce solo id consegna", async () => {
  let request;
  const result = await sendWhatsAppText(
    { to: "+391234567890", text: "Ciao Mario", tenantId: "default" },
    whatsappEnv,
    async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ messages: [{ id: "wamid.123" }] }) };
    }
  );
  assert.equal(result.sent, true);
  assert.equal(result.id, "wamid.123");
  assert.match(request.url, /123456\/messages$/);
  const body = JSON.parse(request.options.body);
  assert.equal(body.to, "+391234567890");
  assert.equal(body.text.body, "Ciao Mario");
});

test("email usa Resend con testo semplice", async () => {
  let request;
  const result = await sendEmailText(
    { to: "mario@example.com", subject: "Richiamo", text: "Ciao Mario" },
    emailEnv,
    async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ id: "email_123" }) };
    }
  );
  assert.equal(result.sent, true);
  assert.equal(result.id, "email_123");
  assert.equal(request.url, "https://api.resend.com/emails");
  const body = JSON.parse(request.options.body);
  assert.deepEqual(body.to, ["mario@example.com"]);
  assert.equal(body.text, "Ciao Mario");
});

test("una proposta non approvata non viene mai inviata", async () => {
  let calls = 0;
  const result = await deliverAuthorizedProposal(
    { channel: "whatsapp", recipient: "+391234567890", text: "Ciao", requiresApproval: true },
    "default",
    whatsappEnv,
    async () => { calls += 1; return { ok: true, json: async () => ({}) }; }
  );
  assert.equal(result.sent, false);
  assert.equal(result.reason, "approval-required");
  assert.equal(calls, 0);
});

test("una proposta approvata viene instradata solo al canale dichiarato", async () => {
  let calls = 0;
  const result = await deliverAuthorizedProposal(
    { channel: "whatsapp", recipient: "+391234567890", text: "Ciao", approved: true, requiresApproval: true },
    "default",
    whatsappEnv,
    async () => {
      calls += 1;
      return { ok: true, json: async () => ({ messages: [{ id: "wamid.ok" }] }) };
    }
  );
  assert.equal(result.sent, true);
  assert.equal(result.channel, "whatsapp");
  assert.equal(calls, 1);
});

test("canali sconosciuti e payload vuoti falliscono chiusi", async () => {
  assert.deepEqual(
    await deliverAuthorizedProposal({ channel: "sms", approved: true, text: "Ciao" }, "default", {}, async () => {}),
    { sent: false, reason: "unsupported-channel" }
  );
  assert.equal((await sendWhatsAppText({ to: "", text: "" }, whatsappEnv, async () => {})).reason, "invalid-message");
  assert.equal((await sendEmailText({ to: "", text: "" }, emailEnv, async () => {})).reason, "invalid-message");
});
