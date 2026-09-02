const clean = value => String(value ?? "").trim().toLowerCase();

export function assistantRole(body = {}) {
  const mode = clean(body?.mode);
  const role = clean(body?.role);
  if (mode === "owner" || role === "owner") return "owner";
  if (["client", "customer", "public"].includes(mode) || ["client", "customer", "public"].includes(role)) return "client";
  return "unknown";
}

export function isExplicitOwnerChat(body = {}) {
  return clean(body?.action) === "chat" && assistantRole(body) === "owner";
}
