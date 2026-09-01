import { normalizeTenantId } from "./tenant.js";

function clean(value) {
  return String(value ?? "").trim();
}

export function whatsappMetadata(body = {}) {
  const entries = Array.isArray(body?.entry) ? body.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];

    for (const change of changes) {
      const metadata = change?.value?.metadata;
      if (!metadata || typeof metadata !== "object") continue;

      const phoneNumberId = clean(metadata.phone_number_id);
      const displayPhoneNumber = clean(metadata.display_phone_number);

      if (phoneNumberId || displayPhoneNumber) {
        return { phoneNumberId, displayPhoneNumber };
      }
    }
  }

  return { phoneNumberId: "", displayPhoneNumber: "" };
}

export function whatsappTenantMap(env = process.env) {
  const configured = clean(env.MAVIRI_WHATSAPP_TENANTS);
  if (!configured) return {};

  try {
    const parsed = JSON.parse(configured);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed)
        .map(([key, value]) => {
          const routeKey = clean(key);
          const tenantValue =
            value && typeof value === "object" && !Array.isArray(value)
              ? value.tenantId || value.tenant || ""
              : value;
          const tenantId = normalizeTenantId(tenantValue, "");
          return routeKey && tenantId ? [routeKey, tenantId] : null;
        })
        .filter(Boolean)
    );
  } catch {
    return {};
  }
}

export function resolveWhatsAppTenant(body = {}, env = process.env) {
  const metadata = whatsappMetadata(body);
  const routes = whatsappTenantMap(env);

  const mapped =
    routes[metadata.phoneNumberId] ||
    routes[metadata.displayPhoneNumber] ||
    "";

  if (mapped) return mapped;

  return normalizeTenantId(env.MAVIRI_DEFAULT_TENANT || "default");
}

export function whatsappSessionKey(tenantId, phone) {
  const tenant = normalizeTenantId(tenantId);
  const client = clean(phone);
  return `maviri:tenant:${tenant}:whatsapp:session:${client}`;
}

export function whatsappProcessedKey(tenantId, messageId) {
  const tenant = normalizeTenantId(tenantId);
  const id = clean(messageId);
  return `maviri:tenant:${tenant}:whatsapp:processed:${id}`;
}
