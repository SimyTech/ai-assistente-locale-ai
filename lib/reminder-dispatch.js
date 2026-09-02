import { normalizeTenantId, tenantDataKey } from "./tenant.js";
import { whatsappTenantMap } from "./whatsapp-tenant.js";

const clean = value => String(value ?? "").trim();

export function reminderStateKey(tenantId) {
  const id = normalizeTenantId(tenantId);
  return id === "default"
    ? "maviri:reminders:state"
    : `maviri:tenant:${id}:reminders:state`;
}

export function tenantIdFromOwnerDataKey(key) {
  const value = clean(key);
  if (value === tenantDataKey("default")) return "default";
  const match = value.match(/^maviri:tenant:([^:]+):owner-data$/);
  return normalizeTenantId(match?.[1] || "default");
}

export function tenantOwnerDataKeys(tenantIds = []) {
  const seen = new Set();
  const keys = [];
  for (const value of Array.isArray(tenantIds) ? tenantIds : []) {
    const id = normalizeTenantId(value);
    if (seen.has(id)) continue;
    seen.add(id);
    keys.push(tenantDataKey(id));
  }
  return keys;
}

export function whatsappOutboundTenantMap(env = process.env) {
  return Object.fromEntries(
    Object.entries(whatsappTenantMap(env))
      .filter(([routeKey]) => /^\d+$/.test(clean(routeKey)))
  );
}

export function whatsappPhoneNumberIdForTenant(tenantId, env = process.env) {
  const tenant = normalizeTenantId(tenantId);
  const routes = whatsappTenantMap(env);
  const routeEntries = Object.entries(routes);
  const outboundEntries = Object.entries(whatsappOutboundTenantMap(env));
  const mapped = outboundEntries.find(([, mappedTenant]) => normalizeTenantId(mappedTenant) === tenant)?.[0] || "";
  if (mapped) return clean(mapped);

  // Legacy/single-tenant compatibility: use the global sender only when no
  // explicit tenant routing exists, or for the default tenant. Once any map is
  // configured, never let an unmapped tenant borrow another activity's number.
  if (!routeEntries.length || tenant === "default") {
    return clean(env.WHATSAPP_PHONE_NUMBER_ID);
  }
  return "";
}
