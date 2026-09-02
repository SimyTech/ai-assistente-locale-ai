import test from "node:test";
import assert from "node:assert/strict";
import { whatsappReminderConfigured } from "../lib/reminders-handler.js";

test("i promemoria risultano configurati con phone_number_id globale", () => {
  assert.equal(whatsappReminderConfigured({
    WHATSAPP_ACCESS_TOKEN: "token",
    WHATSAPP_PHONE_NUMBER_ID: "123456"
  }), true);
});

test("i promemoria risultano configurati con route multi-tenant outbound valida", () => {
  assert.equal(whatsappReminderConfigured({
    WHATSAPP_ACCESS_TOKEN: "token",
    MAVIRI_WHATSAPP_TENANTS: JSON.stringify({ "123456": "salone-rosa" })
  }), true);
});

test("numero visualizzato o JSON invalido non bastano per l'invio promemoria", () => {
  assert.equal(whatsappReminderConfigured({
    WHATSAPP_ACCESS_TOKEN: "token",
    MAVIRI_WHATSAPP_TENANTS: JSON.stringify({ "+39 333 123 4567": "salone-rosa" })
  }), false);
  assert.equal(whatsappReminderConfigured({
    WHATSAPP_ACCESS_TOKEN: "token",
    MAVIRI_WHATSAPP_TENANTS: "{not-json"
  }), false);
});
