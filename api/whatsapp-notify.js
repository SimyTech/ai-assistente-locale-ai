import { ownerAuthorized } from "../lib/auth.js";
import { buildMaviEntryUrl } from "../lib/mavi-entry-link.js";
import { resolveTenantId } from "../lib/tenant.js";

const clean = value => String(value ?? "").trim();

function originFor(req) {
  const configured = clean(process.env.MAVIRI_PUBLIC_URL).replace(/\/$/, "");
  if (configured) return configured;
  const proto = clean(req.headers?.["x-forwarded-proto"]) || "https";
  const host = clean(req.headers?.["x-forwarded-host"] || req.headers?.host);
  return host ? `${proto}://${host}` : "";
}

function composeMessage({ message, businessName, appointment, link }) {
  const custom = clean(message);
  if (custom) return `${custom}\n\nApri Mavi: ${link}`;

  const name = clean(businessName) || "l'attività";
  const service = clean(appointment?.service || appointment?.serviceName);
  const date = clean(appointment?.date);
  const time = clean(appointment?.time);
  const details = [service, date, time ? `alle ${time}` : ""].filter(Boolean).join(" · ");

  return details
    ? `${name}: hai un aggiornamento sul tuo appuntamento (${details}).\n\nPer gestirlo o scrivere a Mavi, apri questo link:\n${link}`
    : `${name}: hai un messaggio da Mavi.\n\nApri la chat qui:\n${link}`;
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

  const to = clean(body.to || body.phone || body.whatsapp);
  if (!to) return res.status(400).json({ ok: false, error: "Numero WhatsApp obbligatorio." });

  const origin = originFor(req);
  if (!origin) return res.status(500).json({ ok: false, error: "URL pubblico Maviri non configurato." });

  try {
    const link = buildMaviEntryUrl({
      origin,
      tenantId,
      clientId: clean(body.clientId),
      appointmentId: clean(body.appointmentId || body.appointment?.id),
      ttlMs: body.ttlMs
    });

    const message = composeMessage({
      message: body.message,
      businessName: body.businessName,
      appointment: body.appointment,
      link
    });

    const sent = await sendWhatsAppText({
      to,
      body: message,
      phoneNumberId: clean(body.phoneNumberId)
    });

    return res.status(200).json({
      ok: true,
      tenantId,
      to,
      link,
      message,
      whatsappMessageId: clean(sent?.messages?.[0]?.id) || null
    });
  } catch (error) {
    console.error("MAVIRI WHATSAPP NOTIFY ERROR:", error);
    return res.status(500).json({ ok: false, error: clean(error?.message) || "Invio WhatsApp non riuscito." });
  }
}
