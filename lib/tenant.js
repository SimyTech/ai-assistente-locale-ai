const TENANT_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export const LEGACY_TENANT_ID = "default";

export function normalizeTenantId(value, fallback = LEGACY_TENANT_ID) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");

  return TENANT_PATTERN.test(normalized) ? normalized : fallback;
}

export function resolveTenantId(req = {}, body = {}) {
  const headers = req.headers || {};
  return normalizeTenantId(
    headers["x-maviri-tenant"] ||
      body.tenantId ||
      body.tenant ||
      process.env.MAVIRI_DEFAULT_TENANT ||
      LEGACY_TENANT_ID
  );
}

export function tenantDataKey(tenantId) {
  const id = normalizeTenantId(tenantId);
  return id === LEGACY_TENANT_ID
    ? "maviri:owner-data"
    : `maviri:tenant:${id}:owner-data`;
}

export function tenantPublicKey(tenantId) {
  const id = normalizeTenantId(tenantId);
  return id === LEGACY_TENANT_ID
    ? "maviri:public-context"
    : `maviri:tenant:${id}:public-context`;
}

export function tenantLockPrefix(tenantId) {
  const id = normalizeTenantId(tenantId);
  return id === LEGACY_TENANT_ID
    ? "maviri:booking-lock:"
    : `maviri:tenant:${id}:booking-lock:`;
}
