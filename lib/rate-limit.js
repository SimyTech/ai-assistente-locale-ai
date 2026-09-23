import { createHash } from "node:crypto";
import { normalizeTenantId } from "./tenant.js";

export const CLIENT_RATE_LIMITS = Object.freeze({
  auth: { limit: 8, tenantLimit: 60, globalLimit: 120, windowSeconds: 900 },
  register: { limit: 4, tenantLimit: 30, globalLimit: 60, windowSeconds: 3600 },
  account: { limit: 8, tenantLimit: 60, globalLimit: 180, windowSeconds: 600 },
  chat: { limit: 30, tenantLimit: 180, globalLimit: 600, windowSeconds: 60 },
  availability: { limit: 40, tenantLimit: 240, globalLimit: 800, windowSeconds: 60 },
  book: { limit: 8, tenantLimit: 50, globalLimit: 120, windowSeconds: 300 },
  update: { limit: 6, tenantLimit: 30, globalLimit: 80, windowSeconds: 300 },
  cancel: { limit: 6, tenantLimit: 30, globalLimit: 80, windowSeconds: 300 },
  "public-context": { limit: 60, tenantLimit: 300, globalLimit: 1000, windowSeconds: 60 },
  context: { limit: 60, tenantLimit: 300, globalLimit: 1000, windowSeconds: 60 }
});

export function clientAddress(req = {}) {
  const forwarded = String(req?.headers?.["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  return forwarded || String(req?.socket?.remoteAddress || "unknown").trim();
}

export function rateLimitKey({ tenantId, action, identity }) {
  const digest = createHash("sha256")
    .update(String(identity || "unknown"))
    .digest("hex")
    .slice(0, 24);
  return `maviri:tenant:${normalizeTenantId(tenantId)}:rate:${action}:${digest}`;
}

export function tenantRateLimitKey({ tenantId, action }) {
  return `maviri:tenant:${normalizeTenantId(tenantId)}:rate:${action}:all`;
}

export function globalRateLimitKey({ action }) {
  return `maviri:global:rate:${String(action || "unknown").toLowerCase()}`;
}

export function rateLimitPolicy(action) {
  return CLIENT_RATE_LIMITS[action] || null;
}
