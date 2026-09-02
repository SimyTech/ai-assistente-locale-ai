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

export function whatsappTenantRoute(body = {}, env = process.env) {
  const metadata = whatsappMetadata(body);
  const routes = whatsappTenantMap(env);
  const routeCount = Object.keys(routes).length;
  const tenantId =
    routes[metadata.phoneNumberId] ||
    routes[metadata.displayPhoneNumber] ||
    "";

  if (tenantId) {
    return {
      accepted: true,
      tenantId,
      mapped: true,
      routeCount,
      phoneNumberId: metadata.phoneNumberId,
      displayPhoneNumber: metadata.displayPhoneNumber
    };
  }

  // Legacy/single-tenant installations may have no routing map at all. In
  // that case the historical default tenant remains valid. Once an explicit
  // multi-tenant map exists, however, an unknown Meta number must fail closed
  // instead of borrowing another activity's default tenant.
  if (!routeCount) {
    return {
      accepted: true,
      tenantId: normalizeTenantId(env.MAVIRI_DEFAULT_TENANT || "default"),
      mapped: false,
      routeCount,
      phoneNumberId: metadata.phoneNumberId,
      displayPhoneNumber: metadata.displayPhoneNumber
    };
  }

  return {
    accepted: false,
    tenantId: "",
    mapped: false,
    routeCount,
    phoneNumberId: metadata.phoneNumberId,
    displayPhoneNumber: metadata.displayPhoneNumber
  };
}

export function resolveWhatsAppTenant(body = {}, env = process.env) {
  const route = whatsappTenantRoute(body, env);
  return route.accepted ? route.tenantId : "";
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
