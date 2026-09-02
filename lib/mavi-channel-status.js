function clean(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function channelForProposal(proposal = {}) {
  const channel = clean(proposal.channel);
  if (channel === "whatsapp" || channel === "email") return channel;
  return "";
}

export function channelReadyForProposal(proposal = {}, status = {}) {
  const channel = channelForProposal(proposal);
  if (!channel) return false;
  return Boolean(status?.channels?.[channel]?.ready);
}

export async function fetchMaviChannelStatus(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") return { ok: false, channels: {} };
  try {
    const response = await fetchImpl("/api/health?mode=channels", { method: "GET", headers: { Accept: "application/json" }, cache: "no-store" });
    if (!response?.ok) return { ok: false, channels: {} };
    const body = await response.json();
    if (!body || body.ok !== true || typeof body.channels !== "object") return { ok: false, channels: {} };
    return body;
  } catch {
    return { ok: false, channels: {} };
  }
}
