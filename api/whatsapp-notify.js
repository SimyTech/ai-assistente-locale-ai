import { ownerAuthorized } from "../lib/auth.js";
import { buildMaviEntryUrl } from "../lib/mavi-entry-link.js";
import { resolveTenantId } from "../lib/tenant.js";

const clean = value => String(value ?? "").trim();

function originFor(req) {
  const configured = clean(process.env.MAVIRI_PUBLIC_URL).replace(/\/$/, "");
  if (configured) return configured;
  const proto = clean(req?.headers?.["x-forwarded-proto"]) || "https";
  const host = clean(req?.headers?.["x-forwarded-host"] || req?.headers?.host);
  return host ? `${proto}://${host}` : "";
}

function eventMessage(eventType, businessName, appointment) {
  const name = clean(businessName) || "L'attività";
  const service = clean(appointment?.service || appointment?.serviceName);
  const date = clean(appointment?.date);
  const time = clean(appointment?.time);
  const details = [service, date, time ? `alle ${time}` : ""].filter(Boolean).join(" · ");

  if (eventType === "created" || eventType === "confirmed") {
    return details ? `${name}: appuntamento confermato (${details}).` : `${name}: il tuo appuntamento è confermato.`;
  }
  if (eventType === "updated" || eventType === "rescheduled") {
    return details ? `${name}: il tuo appuntamento è stato aggiornato (${details}).` : `${name}: il tuo appuntamento è stato aggiornato.`;
  }
  if (eventType === "cancelled" || eventType === "canceled") {
    return details ? `${name}: il tuo appuntamento è stato cancellato (${details}).` : `${name}: il tuo appuntamento è stato cancellato.`;
  }
  return details ? `${name}: aggiornamento appuntamento (${details}).` : `${name}: hai un aggiornamento sul tuo appuntamento.`;
}

function composeMessage({ message, businessName, appointment, link, eventType }) {
  const custom = clean(message);
  const intro = custom || eventMessage(clean(eventType).toLowerCase(), businessName, appointment);
  return `${intro}\n\nPer gestire l'appuntamento o scrivere a Mavi, apri questo link:\n${link}`;
}

async function sendWhatsAppText({ to, body, phoneNumberId }) {
  const token = clean(process.env.WHATSAPP_ACCESS_TOKEN);
  const senderId = clean(phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID);
  if (!token || !senderId) throw new Error("WhatsApp Cloud API non configurata.");

  const response = await fetch(`https://graph.facebook.com/v23.0/${senderId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: clean(to),
      type: "text",
      text: {
        preview_url: true,
        body: clean(body)
      }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `WhatsApp HTTP ${response.status}`);
  return data;
}

export async function sendAutomaticWhatsAppNotification({
  req,
  tenantId,
  to,
  clientId = "",
  appointmentId = "",
  appointment = null,
  businessName = "",
  message = "",
  eventType = "updated",
  phoneNumberId = "",
  ttlMs
} = {}) {
  const phone = clean(to || appointment?.whatsapp || appointment?.phone);
  if (!phone) return { ok: false, skipped: true, reason: "missing-phone" };

  const origin = originFor(req);
  if (!origin) throw new Error("URL pubblico Maviri non configurato.");

  const link = buildMaviEntryUrl({
    origin,
    tenantId,
    clientId: clean(clientId || appointment?.clientId),
    appointmentId: clean(appointmentId || appointment?.id),
    ttlMs
  });

  const text = composeMessage({
    message,
    businessName,
    appointment,
    link,
    eventType
  });

  const sent = await sendWhatsAppText({
    to: phone,
    body: text,
    phoneNumberId
  });

  return {
    ok: true,
    tenantId,
    to: phone,
    link,
    message: text,
    whatsappMessageId: clean(sent?.messages?.[0]?.id) || null
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Metodo non consentito." });
  }

  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const tenantId = resolveTenantId(req, body);

  if (!ownerAuthorized(req, tenantId)) {
    return res.status(401).json({ ok: false, error: "Autorizzazione proprietario richiesta." });
  }

  try {
    const result = await sendAutomaticWhatsAppNotification({
      req,
      tenantId,
      to: body.to || body.phone || body.whatsapp,
      clientId: body.clientId,
      appointmentId: body.appointmentId,
      appointment: body.appointment,
      businessName: body.businessName,
      message: body.message,
      eventType: body.eventType,
      phoneNumberId: body.phoneNumberId,
      ttlMs: body.ttlMs
    });

    if (result.skipped) {
      return res.status(400).json({ ok: false, error: "Numero WhatsApp obbligatorio." });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error("MAVIRI WHATSAPP NOTIFY ERROR:", error);
    return res.status(500).json({ ok: false, error: clean(error?.message) || "Invio WhatsApp non riuscito." });
  }
}
