import { proposalActionId } from "./mavi-action-lifecycle.js";

const clean = value => String(value ?? "").trim();

export function authorizedSendPayload(proposal = {}, tenantId = "default") {
  return {
    action: "authorized-send",
    mode: "owner",
    tenantId: clean(tenantId) || "default",
    actionId: proposalActionId(proposal),
    proposal: { ...proposal, approved: true }
  };
}

export async function requestAuthorizedSend(proposal = {}, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") return { ok: false, error: "transport-unavailable" };
  const payload = authorizedSendPayload(proposal, options.tenantId);
  try {
    const response = await fetchImpl("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify(payload)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true) {
      return { ok: false, status: response.status, error: clean(body?.error) || `HTTP ${response.status}`, actionId: payload.actionId };
    }
    return { ok: true, status: response.status, actionId: payload.actionId, duplicate: Boolean(body.duplicate), delivery: body.delivery || null };
  } catch (error) {
    return { ok: false, error: clean(error?.message) || "network-error", actionId: payload.actionId };
  }
}
