import chatProxy from "./chat-proxy.js";
import { sendAutomaticWhatsAppNotification } from "./whatsapp-notify.js";
import { resolveTenantId } from "../lib/tenant.js";

const clean = value => String(value ?? "").trim();

export function normalizeExplicitDateTimeMessage(body = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  if (clean(body.action) !== "chat") return body;

  const message = clean(body.message);
  if (!message) return body;

  const hasExplicitDate = /\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/.test(message);
  if (!hasExplicitDate) return body;

  const explicitTime = message.match(/\b(?:ore|alle|h)\s*([01]?\d|2[0-3])(?:[:.]([0-5]\d))?\b/i);
  if (!explicitTime) return body;

  const hour = String(Number(explicitTime[1])).padStart(2, "0");
  const minute = String(explicitTime[2] || "00").padStart(2, "0");
  const prefix = `ore ${hour}:${minute}`;

  if (message.toLowerCase().startsWith(prefix.toLowerCase())) return body;

  return {
    ...body,
    message: `${prefix} ${message}`
  };
}

function notificationEventForAction(action, body = {}, payload = {}) {
  if (action === "book") return "confirmed";
  if (action === "cancel") return "cancelled";
  if (action === "update") {
    const changedDate = clean(body.date || body.newDate);
    const changedTime = clean(body.time || body.newTime);
    return changedDate || changedTime ? "rescheduled" : "updated";
  }
  return "";
}

function appointmentForNotification(body = {}, payload = {}) {
  const returned =
    payload?.appointment ||
    payload?.updatedAppointment ||
    payload?.cancelledAppointment ||
    null;

  if (returned && typeof returned === "object" && !Array.isArray(returned)) {
    return returned;
  }

  const source = body.appointment && typeof body.appointment === "object" && !Array.isArray(body.appointment)
    ? body.appointment
    : {};

  return {
    ...source,
    id: clean(source.id || body.appointmentId || body.id),
    clientId: clean(source.clientId || body.clientId),
    name: clean(source.name || body.name || body.clientName),
    service: clean(source.service || source.serviceName || body.service || body.serviceName),
    date: clean(source.date || body.date || body.newDate),
    time: clean(source.time || body.time || body.newTime),
    phone: clean(source.phone || body.phone || body.clientPhone),
    whatsapp: clean(source.whatsapp || body.whatsapp || body.clientWhatsapp)
  };
}

function shouldNotify(body = {}, payload = {}, statusCode = 200) {
  const action = clean(body.action).toLowerCase();
  if (!["book", "update", "cancel"].includes(action)) return false;
  if (Number(statusCode) >= 400 || payload?.ok === false) return false;

  const role = clean(body.role || body.mode).toLowerCase();
  const source = clean(body.source || body.channel).toLowerCase();

  // A client already inside Mavi Chat does not need another WhatsApp for the same action.
  if (role === "client" || source === "mavi-link" || source === "whatsapp-link") return false;

  return true;
}

async function notifyAppointmentEvent(req, body, payload, statusCode) {
  if (!shouldNotify(body, payload, statusCode)) return;

  const action = clean(body.action).toLowerCase();
  const appointment = appointmentForNotification(body, payload);
  const to = clean(
    appointment.whatsapp ||
    appointment.phone ||
    payload?.whatsapp ||
    payload?.phone ||
    body.whatsapp ||
    body.phone ||
    body.clientWhatsapp ||
    body.clientPhone
  );

  if (!to) return;

  const tenantId = resolveTenantId(req, body);
  const businessName = clean(
    body.businessName ||
    body.business?.name ||
    body.settings?.businessName ||
    body.settings?.name
  );

  try {
    await sendAutomaticWhatsAppNotification({
      req,
      tenantId,
      to,
      clientId: clean(appointment.clientId || body.clientId),
      appointmentId: clean(appointment.id || body.appointmentId || body.id),
      appointment,
      businessName,
      eventType: notificationEventForAction(action, body, payload)
    });
  } catch (error) {
    // L'operazione principale resta valida anche se WhatsApp è temporaneamente indisponibile.
    console.error("MAVIRI APPOINTMENT WHATSAPP NOTIFICATION ERROR:", error);
  }
}

export default async function handler(req, res) {
  if (req?.method === "POST") {
    req.body = normalizeExplicitDateTimeMessage(req.body);

    const bodySnapshot =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? { ...req.body }
        : {};

    const originalJson = res.json.bind(res);
    res.json = payload => {
      const statusCode = res.statusCode || 200;
      return notifyAppointmentEvent(req, bodySnapshot, payload, statusCode)
        .then(() => originalJson(payload));
    };
  }

  return chatProxy(req, res);
}
