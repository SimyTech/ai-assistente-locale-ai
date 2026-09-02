import test from "node:test";
import assert from "node:assert/strict";

import {
  reminderStateKey,
  tenantIdFromOwnerDataKey,
  tenantOwnerDataKeys,
  whatsappOutboundTenantMap,
  whatsappPhoneNumberIdForTenant
} from "../lib/reminder-dispatch.js";

test("costruisce chiavi stato promemoria per default e tenant", () => {
  assert.equal(reminderStateKey("default"), "maviri:reminders:state");
  assert.equal(reminderStateKey("salone-rosa"), "maviri:tenant:salone-rosa:reminders:state");
});

test("ricava il tenant dalla chiave owner-data", () => {
  assert.equal(tenantIdFromOwnerDataKey("maviri:owner-data"), "default");
  assert.equal(tenantIdFromOwnerDataKey("maviri:tenant:salone-rosa:owner-data"), "salone-rosa");
});

test("crea chiavi owner-data senza duplicati e normalizza i tenant", () => {
  assert.deepEqual(
    tenantOwnerDataKeys(["default", "Salone_Rosa", "salone-rosa"]),
    ["maviri:owner-data", "maviri:tenant:salone-rosa:owner-data"]
  );
});

test("instrada ogni tenant sul proprio phone_number_id WhatsApp", () => {
  const env = {
    MAVIRI_WHATSAPP_TENANTS: JSON.stringify({
      "111111": "salone-rosa",
      "222222": "studio-verdi"
    }),
    WHATSAPP_PHONE_NUMBER_ID: "999999"
  };
  assert.equal(whatsappPhoneNumberIdForTenant("salone-rosa", env), "111111");
  assert.equal(whatsappPhoneNumberIdForTenant("studio-verdi", env), "222222");
});

test("non usa il numero visualizzato come phone_number_id per l'uscita", () => {
  const env = {
    MAVIRI_WHATSAPP_TENANTS: JSON.stringify({
      "+39 333 123 4567": "salone-rosa",
      "222222": "studio-verdi"
    })
  };
  assert.deepEqual(whatsappOutboundTenantMap(env), { "222222": "studio-verdi" });
  assert.equal(whatsappPhoneNumberIdForTenant("salone-rosa", env), "");
  assert.equal(whatsappPhoneNumberIdForTenant("studio-verdi", env), "222222");
});

test("non usa il numero globale di un'altra attività per tenant non mappati", () => {
  const env = {
    MAVIRI_WHATSAPP_TENANTS: JSON.stringify({ "111111": "salone-rosa" }),
    WHATSAPP_PHONE_NUMBER_ID: "999999"
  };
  assert.equal(whatsappPhoneNumberIdForTenant("studio-verdi", env), "");
});

test("mantiene il fallback globale per installazioni legacy o tenant default", () => {
  assert.equal(
    whatsappPhoneNumberIdForTenant("salone-rosa", { WHATSAPP_PHONE_NUMBER_ID: "999999" }),
    "999999"
  );
  assert.equal(
    whatsappPhoneNumberIdForTenant("default", {
      MAVIRI_WHATSAPP_TENANTS: JSON.stringify({ "111111": "salone-rosa" }),
      WHATSAPP_PHONE_NUMBER_ID: "999999"
    }),
    "999999"
  );
});
