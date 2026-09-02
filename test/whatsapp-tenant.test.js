import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  resolveWhatsAppTenant,
  whatsappMetadata,
  whatsappProcessedKey,
  whatsappSessionKey,
  whatsappTenantMap,
  whatsappTenantRoute
} from "../lib/whatsapp-tenant.js";

const body = phoneNumberId => ({
  entry: [
    {
      changes: [
        {
          value: {
            metadata: {
              phone_number_id: phoneNumberId,
              display_phone_number: "+39 333 123 4567"
            }
          }
        }
      ]
    }
  ]
});

test("estrae i metadati del numero WhatsApp business", () => {
  assert.deepEqual(whatsappMetadata(body("12345")), {
    phoneNumberId: "12345",
    displayPhoneNumber: "+39 333 123 4567"
  });
});

test("instrada un phone_number_id verso il tenant corretto", () => {
  const env = {
    MAVIRI_DEFAULT_TENANT: "default",
    MAVIRI_WHATSAPP_TENANTS: JSON.stringify({
      "12345": "salone-anna",
      "67890": { tenantId: "barber-luca" }
    })
  };

  assert.equal(resolveWhatsAppTenant(body("12345"), env), "salone-anna");
  assert.equal(resolveWhatsAppTenant(body("67890"), env), "barber-luca");
});

test("usa il numero visualizzato come fallback di routing", () => {
  const env = {
    MAVIRI_WHATSAPP_TENANTS: JSON.stringify({
      "+39 333 123 4567": "estetica-mia"
    })
  };

  assert.equal(resolveWhatsAppTenant(body("unknown"), env), "estetica-mia");
});

test("usa il tenant predefinito in modalita legacy senza mappa", () => {
  const route = whatsappTenantRoute(body("unknown"), { MAVIRI_DEFAULT_TENANT: "Demo_Salone" });
  assert.equal(route.accepted, true);
  assert.equal(route.mapped, false);
  assert.equal(route.tenantId, "demo-salone");
  assert.equal(resolveWhatsAppTenant(body("unknown"), { MAVIRI_DEFAULT_TENANT: "Demo_Salone" }), "demo-salone");
});

test("rifiuta un numero WhatsApp sconosciuto quando esiste una mappa multi-tenant", () => {
  const env = {
    MAVIRI_DEFAULT_TENANT: "default",
    MAVIRI_WHATSAPP_TENANTS: JSON.stringify({
      "12345": "salone-anna",
      "67890": "barber-luca"
    })
  };
  const unknownBody = {
    entry: [{ changes: [{ value: { metadata: { phone_number_id: "99999", display_phone_number: "+39 320 000 0000" } } }] }]
  };
  const route = whatsappTenantRoute(unknownBody, env);
  assert.equal(route.accepted, false);
  assert.equal(route.tenantId, "");
  assert.equal(route.routeCount, 2);
  assert.equal(resolveWhatsAppTenant(unknownBody, env), "");
});

test("ignora configurazioni JSON non valide", () => {
  assert.deepEqual(whatsappTenantMap({ MAVIRI_WHATSAPP_TENANTS: "{" }), {});
});

test("le chiavi Redis WhatsApp sono separate per tenant", () => {
  assert.equal(
    whatsappSessionKey("salone-anna", "393331234567"),
    "maviri:tenant:salone-anna:whatsapp:session:393331234567"
  );
  assert.equal(
    whatsappProcessedKey("barber-luca", "wamid.123"),
    "maviri:tenant:barber-luca:whatsapp:processed:wamid.123"
  );
});

test("il proxy applica il guard prima di cancellazioni e Business Engine", async () => {
  const proxy = await readFile(new URL("../api/whatsapp-proxy.js", import.meta.url), "utf8");
  const routeGuard = proxy.indexOf("const route = whatsappTenantRoute");
  const cancellationGuard = proxy.indexOf("handleSafeCancellation(req, res)");
  const businessHandler = proxy.indexOf("return whatsappHandler(req, res)", cancellationGuard);
  assert.ok(routeGuard >= 0);
  assert.ok(cancellationGuard > routeGuard);
  assert.ok(businessHandler > cancellationGuard);
  assert.match(proxy, /reason: "unmapped-whatsapp-number"/);
});
