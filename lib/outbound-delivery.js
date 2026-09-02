import { whatsappPhoneNumberIdForTenant } from "./reminder-dispatch.js";

const clean = value => String(value ?? "").replace(/\u0000/g, "").trim();

export function whatsappDeliveryConfigured(tenantId = "default", env = process.env) {
  return Boolean(clean(env.WHATSAPP_ACCESS_TOKEN) && whatsappPhoneNumberIdForTenant(tenantId, env));
}

export function emailDeliveryConfigured(env = process.env) {
  return Boolean(clean(env.RESEND_API_KEY) && clean(env.MAVIRI_EMAIL_FROM));
}

export async function sendWhatsAppText({ to, text, tenantId = "default" }, env = process.env, fetchImpl = globalThis.fetch) {
  const token = clean(env.WHATSAPP_ACCESS_TOKEN);
  const phoneNumberId = whatsappPhoneNumberIdForTenant(tenantId, env);
  const recipient = clean(to);
  const body = clean(text);
  if (!token || !phoneNumberId) return { sent: false, reason: "whatsapp-not-configured" };
  if (!recipient || !body) return { sent: false, reason: "invalid-message" };
  if (typeof fetchImpl !== "function") return { sent: false, reason: "transport-unavailable" };

  const response = await fetchImpl(`https://graph.facebook.com/v23.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient,
      type: "text",
      text: { preview_url: false, body }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `WhatsApp HTTP ${response.status}`);
  return { sent: true, id: clean(payload?.messages?.[0]?.id) || null, channel: "whatsapp" };
}

export async function sendEmailText({ to, subject = "Messaggio da Maviri", text }, env = process.env, fetchImpl = globalThis.fetch) {
  const apiKey = clean(env.RESEND_API_KEY);
  const from = clean(env.MAVIRI_EMAIL_FROM);
  const recipient = clean(to).toLowerCase();
  const body = clean(text);
  if (!apiKey || !from) return { sent: false, reason: "email-not-configured" };
  if (!recipient || !body) return { sent: false, reason: "invalid-message" };
  if (typeof fetchImpl !== "function") return { sent: false, reason: "transport-unavailable" };

  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [recipient], subject: clean(subject) || "Messaggio da Maviri", text: body })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || `Invio email HTTP ${response.status}`);
  return { sent: true, id: clean(payload?.id) || null, channel: "email" };
}

export async function deliverAuthorizedProposal(proposal = {}, tenantId = "default", env = process.env, fetchImpl = globalThis.fetch) {
  const channel = clean(proposal.channel).toLowerCase();
  if (proposal.approved !== true && proposal.requiresApproval !== false) {
    return { sent: false, reason: "approval-required" };
  }
  if (channel === "whatsapp") {
    return sendWhatsAppText({ to: proposal.recipient, text: proposal.text, tenantId }, env, fetchImpl);
  }
  if (channel === "email") {
    return sendEmailText({ to: proposal.recipient, subject: proposal.subject, text: proposal.text }, env, fetchImpl);
  }
  return { sent: false, reason: "unsupported-channel" };
}
