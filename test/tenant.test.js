import test from "node:test";
import assert from "node:assert/strict";
import { LEGACY_TENANT_ID, normalizeTenantId, resolveTenantId, tenantDataKey, tenantLockPrefix, tenantPublicKey } from "../lib/tenant.js";

test("mantiene compatibilità con il tenant storico", () => {
  assert.equal(normalizeTenantId(""), LEGACY_TENANT_ID);
  assert.equal(tenantDataKey("default"), "maviri:owner-data");
  assert.equal(tenantPublicKey("default"), "maviri:public-context");
  assert.equal(tenantLockPrefix("default"), "maviri:booking-lock:");
});

test("separa completamente le chiavi di due attività", () => {
  assert.equal(tenantDataKey("salone-aurora"), "maviri:tenant:salone-aurora:owner-data");
  assert.equal(tenantPublicKey("centro-benessere"), "maviri:tenant:centro-benessere:public-context");
  assert.notEqual(tenantLockPrefix("salone-aurora"), tenantLockPrefix("centro-benessere"));
});

test("normalizza gli identificativi e respinge valori pericolosi", () => {
  assert.equal(normalizeTenantId(" Salone_Aurora "), "salone-aurora");
  assert.equal(normalizeTenantId("../redis-admin"), LEGACY_TENANT_ID);
  assert.equal(normalizeTenantId("tenant con spazi"), LEGACY_TENANT_ID);
});

test("risolve prima l'header e poi il body", () => {
  assert.equal(resolveTenantId({ headers: { "x-maviri-tenant": "barber-one" } }, { tenantId: "barber-two" }), "barber-one");
  assert.equal(resolveTenantId({ headers: {} }, { tenantId: "beauty-lab" }), "beauty-lab");
});
