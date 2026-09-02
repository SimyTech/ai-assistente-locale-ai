import { normalizeTenantId, tenantDataKey } from "./tenant.js";

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
