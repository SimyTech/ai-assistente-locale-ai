import test from "node:test";
import assert from "node:assert/strict";
import {
  sendWhatsAppText,
  whatsappDeliveryConfigured,
  whatsappProactiveEnabled
} from "../lib/outbound-delivery.js";

const configuredEnv = {
  WHATSAPP_ACCESS_TOKEN: "wa-secret",
  WHATSAPP_PHONE_NUMBER_ID: "123456"
};

test("WhatsApp proattivo è disabilitato per default", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error("non dovrebbe inviare");
  };

  assert.equal(whatsappProactiveEnabled(configuredEnv), false);
  assert.equal(whatsappDeliveryConfigured("default", configuredEnv), false);

  const result = await sendWhatsAppText(
    { to: "393331112222", text: "Promemoria", tenantId: "default" },
    configuredEnv,
    fetchImpl
  );

  assert.deepEqual(result, { sent: false, reason: "whatsapp-proactive-disabled" });
  assert.equal(calls, 0);
});

test("l'invio proattivo richiede opt-in esplicito", async () => {
  const env = { ...configuredEnv, MAVIRI_WHATSAPP_PROACTIVE: "true" };
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({ messages: [{ id: "wamid-test" }] })
    };
  };

  assert.equal(whatsappProactiveEnabled(env), true);
  assert.equal(whatsappDeliveryConfigured("default", env), true);

  const result = await sendWhatsAppText(
    { to: "393331112222", text: "Messaggio autorizzato", tenantId: "default" },
    env,
    fetchImpl
  );

  assert.equal(result.sent, true);
  assert.equal(result.id, "wamid-test");
  assert.equal(calls, 1);
});
