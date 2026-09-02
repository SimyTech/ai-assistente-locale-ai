/* MAVIRI — WHATSAPP WEBHOOK
 * Multi-tenant WhatsApp Cloud API bridge.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  resolveWhatsAppTenant,
  whatsappMetadata,
  whatsappProcessedKey,
  whatsappSessionKey
} from "../lib/whatsapp-tenant.js";
import { tenantDataKey } from "../lib/tenant.js";
import { listClientAppointments, resolveClientCancellation } from "../lib/whatsapp-cancellation.js";
import {
  extractRescheduleDate,
  extractRescheduleTime,
  isRescheduleRequest,
  normalizeReschedule,
  selectCandidateByNumber
} from "../lib/whatsapp-reschedule.js";
import {
  awaitingField,
  bookingComplete,
  bookingSummary,
  extractTime,
  isCancellation,
  isConfirmation,
  mergeBooking,
  normalizeBooking
} from "../lib/whatsapp-booking.js";

const clean = value => String(value ?? "").replace(/\u0000/g, "").trim();
const MAX_HISTORY = 20;
const SESSION_TTL = 1000 * 60 * 60 * 24 * 7;
const PROCESSED_TTL = 1000 * 60 * 60 * 24;

const redisUrl = () => process.env.UPSTASH_REDIS_REST_URL || "";
const redisToken = () => process.env.UPSTASH_REDIS_REST_TOKEN || "";

function jsonResponse(res, status, data) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(status).json(data);
}

function textResponse(res, status, text) {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  return res.status(status).send(text);
}

async function redisCommand(command, ...args) {
  if (!redisUrl() || !redisToken()) throw new Error("Upstash Redis non configurato.");
  const response = await fetch(redisUrl(), {
    method: "POST",
    headers: { Authorization: `Bearer ${redisToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify([command, ...args])
  });
  if (!response.ok) throw new Error(`Redis HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(String(payload.error));
  return payload.result;
}

async function redisGet(key) {
  const value = await redisCommand("GET", key);
  if (value === null || value === undefined || value === "") return null;
  try { return JSON.parse(value); } catch { return value; }
}

async function redisSet(key, value, ttl = null) {
  const args = [key, JSON.stringify(value)];
  if (ttl) args.push("PX", String(ttl));
  return redisCommand("SET", ...args);
}

function sessionId(tenantId, phone) {
  return `whatsapp-${tenantId}-${clean(phone)}`;
}

async function loadSession(tenantId, phone) {
  const stored = await redisGet(whatsappSessionKey(tenantId, phone));
  if (!stored || typeof stored !== "object") {
    return {
      phone: clean(phone),
      tenantId,
      sessionId: sessionId(tenantId, phone),
      history: [],
      booking: normalizeBooking(),
      reschedule: normalizeReschedule()
    };
  }

  return {
    phone: clean(phone),
    tenantId,
    sessionId: clean(stored.sessionId) || sessionId(tenantId, phone),
    history: Array.isArray(stored.history) ? stored.history.slice(-MAX_HISTORY) : [],
    booking: normalizeBooking(stored.booking),
    reschedule: normalizeReschedule(stored.reschedule)
  };
}

async function saveSession(tenantId, phone, session) {
  await redisSet(
    whatsappSessionKey(tenantId, phone),
    {
      phone: clean(phone),
      tenantId,
      sessionId: clean(session.sessionId) || sessionId(tenantId, phone),
      history: Array.isArray(session.history) ? session.history.slice(-MAX_HISTORY) : [],
      booking: normalizeBooking(session.booking),
      reschedule: normalizeReschedule(session.reschedule)
    },
    SESSION_TTL
  );
}

function addHistory(session, role, content) {
  if (!Array.isArray(session.history)) session.history = [];
  session.history.push({ role: clean(role), content: clean(content) });
  session.history = session.history.slice(-MAX_HISTORY);
}

function extractIncomingMessage(body) {
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value;
      const messages = Array.isArray(value?.messages) ? value.messages : [];
      for (const message of messages) {
        if (message?.type !== "text") continue;
        const phone = clean(message?.from);
        const text = clean(message?.text?.body);
        if (!phone || !text) continue;
        return {
          phone,
          text,
          messageId: clean(message?.id),
          profileName: clean(value?.contacts?.[0]?.profile?.name),
          timestamp: clean(message?.timestamp)
        };
      }
    }
  }
  return null;
}

function verifyWebhook(req) {
  const mode = clean(req.query?.["hub.mode"]);
  const token = clean(req.query?.["hub.verify_token"]);
  const challenge = clean(req.query?.["hub.challenge"]);
  const expected = clean(process.env.WHATSAPP_VERIFY_TOKEN);
  if (mode !== "subscribe") return { ok: false, status: 400 };
  if (!expected || token !== expected) return { ok: false, status: 403 };
  return { ok: true, challenge };
}

function safeEqualHex(left, right) {
  const a = Buffer.from(clean(left));
  const b = Buffer.from(clean(right));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

function verifySignature(req) {
  const secret = clean(process.env.WHATSAPP_APP_SECRET);
  if (!secret) return true;
  const signature = clean(req.headers?.["x-hub-signature-256"]);
  if (!signature.startsWith("sha256=")) return false;
  const raw = req.rawBody;
  if (!raw) return false;
  const source = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw));
  const expected = `sha256=${createHmac("sha256", secret).update(source).digest("hex")}`;
  return safeEqualHex(signature, expected);
}

function originFor(req) {
  return `${req.headers["x-forwarded-proto"] || "https"}://${req.headers["x-forwarded-host"] || req.headers.host}`;
}

async function businessApi(req, tenantId, payload) {
  const response = await fetch(`${originFor(req)}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-maviri-tenant": tenantId },
    body: JSON.stringify({ tenantId, role: "client", mode: "client", channel: "whatsapp", source: "whatsapp", ...payload })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    const error = new Error(data?.error || `Mavi HTTP ${response.status}`);
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

async function callMavi(req, { tenantId, phone, text, profileName, session }) {
  const data = await businessApi(req, tenantId, {
    action: "chat",
    sessionId: session.sessionId,
    message: text,
    history: session.history,
    clientPhone: phone,
    clientWhatsapp: phone,
    clientName: profileName
  });
  const reply = clean(data?.reply || data?.message || data?.response || data?.text || data?.answer);
  if (!reply) throw new Error("Mavi non ha restituito una risposta.");
  return { reply, raw: data };
}

function collectBookingField(session, text, profileName) {
  const booking = normalizeBooking(session.booking);
  const field = awaitingField(booking);

  if (field === "time") {
    const time = extractTime(text);
    if (time) return mergeBooking(booking, { time });
  }

  if (field === "name") {
    const name = clean(text) || clean(profileName);
    if (name) return mergeBooking(booking, { name });
  }

  return booking;
}

async function continueBooking(req, { tenantId, phone, text, profileName, session }) {
  let booking = normalizeBooking(session.booking);

  if (booking.status && isCancellation(text)) {
    session.booking = normalizeBooking();
    return { reply: "Va bene, ho annullato la procedura di prenotazione.", bookingHandled: true };
  }

  if (booking.status === "awaiting-confirmation") {
    if (!isConfirmation(text)) {
      return {
        reply: `La prenotazione non è ancora confermata. Scrivi “confermo” per registrare ${bookingSummary(booking)}, oppure “annulla”.`,
        bookingHandled: true
      };
    }

    const result = await businessApi(req, tenantId, {
      action: "book",
      date: booking.date,
      time: booking.time,
      service: booking.service,
      name: booking.name,
      phone,
      whatsapp: phone,
      confirmed: true,
      persist: true
    });

    session.booking = normalizeBooking();
    return {
      reply: `Perfetto, prenotazione confermata: ${result.appointment?.service || booking.service} il ${result.appointment?.date || booking.date} alle ${result.appointment?.time || booking.time}.`,
      bookingHandled: true,
      appointment: result.appointment || null
    };
  }

  if (booking.status) {
    booking = collectBookingField(session, text, profileName);
    session.booking = booking;

    if (awaitingField(booking) === "time") {
      return { reply: `Per ${booking.service} il ${booking.date}, quale orario preferisci?`, bookingHandled: true };
    }

    if (awaitingField(booking) === "name") {
      const availability = await businessApi(req, tenantId, {
        action: "availability",
        date: booking.date,
        service: booking.service
      });
      if (!Array.isArray(availability.slots) || !availability.slots.includes(booking.time)) {
        session.booking = mergeBooking(booking, { time: "", status: "collecting-time" });
        const slots = Array.isArray(availability.slots) ? availability.slots.join(", ") : "";
        return {
          reply: slots
            ? `Alle ${booking.time} non è più disponibile. Gli orari liberi sono: ${slots}. Quale preferisci?`
            : `Per ${booking.service} il ${booking.date} non risultano più orari disponibili.`,
          bookingHandled: true
        };
      }
      return { reply: "Perfetto. A che nome devo registrare l’appuntamento?", bookingHandled: true };
    }

    if (bookingComplete(booking)) {
      const preview = await businessApi(req, tenantId, {
        action: "book",
        date: booking.date,
        time: booking.time,
        service: booking.service,
        name: booking.name,
        phone,
        whatsapp: phone,
        confirmed: false
      });
      session.booking = mergeBooking(booking, { status: "awaiting-confirmation" });
      return {
        reply: clean(preview.message) || `Confermi ${bookingSummary(booking)}? Scrivi “confermo” per registrarla.`,
        bookingHandled: true
      };
    }
  }

  return { bookingHandled: false };
}

function todayRome() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function appointmentLabel(appointment, index = null) {
  const prefix = index === null ? "" : `${index + 1}) `;
  return `${prefix}${clean(appointment.date)} alle ${clean(appointment.time)} — ${clean(appointment.service)}`;
}

async function continueReschedule(req, { tenantId, phone, text, session }) {
  let state = normalizeReschedule(session.reschedule);
  const key = tenantDataKey(tenantId);
  const data = await redisGet(key);
  if (!data || typeof data !== "object") return null;

  const matches = listClientAppointments(data.appointments, { phone, whatsapp: phone }, todayRome());
  const byId = new Map(matches.map(item => [String(item.id), item]));

  if (state.status) {
    if (isCancellation(text)) {
      session.reschedule = normalizeReschedule();
      return { reply: "Va bene, non sposto l’appuntamento.", bookingHandled: true };
    }

    if (state.status === "selecting-appointment") {
      const selectedId = selectCandidateByNumber(state.candidates, text);
      const selected = byId.get(String(selectedId));
      if (!selected) {
        const options = state.candidates.map((id, index) => appointmentLabel(byId.get(String(id)) || {}, index)).join("; ");
        return { reply: `Indicami il numero dell’appuntamento da spostare: ${options}.`, bookingHandled: true };
      }
      state = { ...state, status: "collecting-date", appointmentId: String(selected.id), candidates: [] };
      session.reschedule = state;
      return { reply: `Va bene. A quale giorno vuoi spostare ${appointmentLabel(selected)}?`, bookingHandled: true };
    }

    const current = byId.get(String(state.appointmentId));
    if (!current) {
      session.reschedule = normalizeReschedule();
      return { reply: "Non trovo più l’appuntamento da spostare. Potrebbe essere già stato modificato o annullato.", bookingHandled: true };
    }

    if (!state.date) state.date = extractRescheduleDate(text, todayRome());
    if (!state.time) state.time = extractRescheduleTime(text);

    if (!state.date) {
      state.status = "collecting-date";
      session.reschedule = state;
      return { reply: "A quale giorno vuoi spostare l’appuntamento?", bookingHandled: true };
    }

    if (!state.time) {
      state.status = "collecting-time";
      session.reschedule = state;
      const availability = await businessApi(req, tenantId, {
        action: "availability",
        date: state.date,
        service: current.service
      });
      const slots = Array.isArray(availability.slots) ? availability.slots : [];
      return {
        reply: slots.length
          ? `Per il ${state.date} sono disponibili: ${slots.join(", ")}. Quale orario preferisci?`
          : `Per il ${state.date} non risultano orari disponibili. Indicami un altro giorno.`,
        bookingHandled: true
      };
    }

    try {
      const result = await businessApi(req, tenantId, {
        action: "update",
        id: current.id,
        date: state.date,
        time: state.time,
        service: current.service,
        name: current.name,
        phone,
        whatsapp: phone,
        email: current.email,
        notes: current.notes,
        status: current.status || "confirmed"
      });
      session.reschedule = normalizeReschedule();
      return {
        reply: `Fatto. Ho spostato l’appuntamento di ${clean(current.service)} al ${clean(result.appointment?.date || state.date)} alle ${clean(result.appointment?.time || state.time)}.`,
        bookingHandled: true,
        appointment: result.appointment || null
      };
    } catch (error) {
      if (Number(error.status) === 409) {
        const slots = Array.isArray(error.payload?.availableSlots) ? error.payload.availableSlots : [];
        state.time = "";
        state.status = "collecting-time";
        session.reschedule = state;
        return {
          reply: slots.length
            ? `Quell’orario non è disponibile. Per il ${state.date} puoi scegliere: ${slots.join(", ")}.`
            : `Quell’orario non è disponibile. Indicami un altro giorno o orario.`,
          bookingHandled: true
        };
      }
      throw error;
    }
  }

  if (!isRescheduleRequest(text) || normalizeBooking(session.booking).status) return null;

  if (!matches.length) {
    return { reply: "Non risultano appuntamenti futuri da spostare per questo numero WhatsApp.", bookingHandled: true };
  }

  if (matches.length > 1) {
    session.reschedule = {
      status: "selecting-appointment",
      appointmentId: "",
      date: "",
      time: "",
      candidates: matches.slice(0, 5).map(item => String(item.id))
    };
    const options = matches.slice(0, 5).map((item, index) => appointmentLabel(item, index)).join("; ");
    return { reply: `Quale appuntamento vuoi spostare? Rispondi con il numero: ${options}.`, bookingHandled: true };
  }

  const current = matches[0];
  state = {
    status: "collecting-date",
    appointmentId: String(current.id),
    date: extractRescheduleDate(text, todayRome()),
    time: extractRescheduleTime(text),
    candidates: []
  };
  session.reschedule = state;

  if (!state.date) {
    return { reply: `A quale giorno vuoi spostare ${appointmentLabel(current)}?`, bookingHandled: true };
  }

  if (!state.time) {
    const availability = await businessApi(req, tenantId, {
      action: "availability",
      date: state.date,
      service: current.service
    });
    const slots = Array.isArray(availability.slots) ? availability.slots : [];
    state.status = "collecting-time";
    session.reschedule = state;
    return {
      reply: slots.length
        ? `Per il ${state.date} sono disponibili: ${slots.join(", ")}. Quale orario preferisci?`
        : `Per il ${state.date} non risultano orari disponibili. Indicami un altro giorno.`,
      bookingHandled: true
    };
  }

  return continueReschedule(req, { tenantId, phone, text: `${state.date} alle ${state.time}`, session });
}

async function cancelRequestedAppointment({ tenantId, phone, text, session }) {
  if (normalizeBooking(session.booking).status || normalizeReschedule(session.reschedule).status || !isCancellation(text)) return null;
  const key = tenantDataKey(tenantId);
  const data = await redisGet(key);
  if (!data || typeof data !== "object") return null;

  const resolution = resolveClientCancellation(
    data.appointments,
    { phone, whatsapp: phone },
    todayRome(),
    text
  );

  if (!resolution.matches.length) return null;
  if (!resolution.appointment) {
    const options = resolution.matches
      .slice(0, 5)
      .map(item => `${clean(item.date)} alle ${clean(item.time)} — ${clean(item.service)}`)
      .join("; ");
    return {
      reply: `Hai più appuntamenti futuri: ${options}. Quale vuoi annullare? Scrivi ad esempio “annulla quello delle 10:00” oppure indica il servizio.`,
      bookingHandled: true,
      appointment: null
    };
  }

  const appointment = resolution.appointment;
  const cancelledAt = new Date().toISOString();
  const nextAppointment = {
    ...appointment,
    status: "cancelled",
    cancelledAt,
    cancellationReason: "Annullato dal cliente via WhatsApp",
    updatedAt: cancelledAt
  };
  const nextAppointments = (Array.isArray(data.appointments) ? data.appointments : []).map(item =>
    String(item?.id) === String(appointment.id) ? nextAppointment : item
  );
  const nextData = {
    ...data,
    appointments: nextAppointments,
    revision: Number(data.revision || 0) + 1,
    updatedAt: cancelledAt
  };
  await redisSet(key, nextData);

  return {
    reply: `Va bene, ho annullato il tuo appuntamento del ${clean(appointment.date)} alle ${clean(appointment.time)} per ${clean(appointment.service)}.`,
    bookingHandled: true,
    appointment: nextAppointment
  };
}

async function confirmRequestedAttendance(req, { tenantId, phone, text, session }) {
  if (normalizeBooking(session.booking).status || normalizeReschedule(session.reschedule).status || !isConfirmation(text)) return null;
  try {
    const result = await businessApi(req, tenantId, {
      action: "confirm-attendance",
      phone,
      whatsapp: phone
    });
    return {
      reply: clean(result.message) || "Presenza confermata. Grazie!",
      bookingHandled: true,
      appointments: Array.isArray(result.appointments) ? result.appointments : []
    };
  } catch {
    return null;
  }
}

async function sendWhatsAppMessage(to, message, phoneNumberId) {
  const token = clean(process.env.WHATSAPP_ACCESS_TOKEN);
  const senderId = clean(phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID);
  if (!token || !senderId) throw new Error("WhatsApp Cloud API non configurata.");
  const response = await fetch(`https://graph.facebook.com/v23.0/${senderId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: clean(to),
      type: "text",
      text: { preview_url: false, body: clean(message) }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `WhatsApp HTTP ${response.status}`);
  return data;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method === "GET") {
    const verification = verifyWebhook(req);
    if (!verification.ok) return textResponse(res, verification.status, "Forbidden");
    return textResponse(res, 200, verification.challenge);
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return jsonResponse(res, 405, { ok: false, error: "Method Not Allowed" });
  }

  if (!verifySignature(req)) {
    return jsonResponse(res, 401, { ok: false, error: "Firma WhatsApp non valida." });
  }

  const metadata = whatsappMetadata(req.body);
  const tenantId = resolveWhatsAppTenant(req.body);
  const incoming = extractIncomingMessage(req.body);

  if (!incoming) return jsonResponse(res, 200, { ok: true, ignored: true, tenantId });

  const { phone, messageId, text, profileName } = incoming;

  try {
    const session = await loadSession(tenantId, phone);
    const processedKey = messageId ? whatsappProcessedKey(tenantId, messageId) : "";

    if (processedKey) {
      const alreadyProcessed = await redisGet(processedKey);
      if (alreadyProcessed) return jsonResponse(res, 200, { ok: true, duplicate: true, tenantId, messageId });
      await redisSet(processedKey, { tenantId, phone, messageId }, PROCESSED_TTL);
    }

    addHistory(session, "user", text);

    let responsePayload = await continueReschedule(req, { tenantId, phone, text, session });
    if (!responsePayload) responsePayload = await cancelRequestedAppointment({ tenantId, phone, text, session });
    if (!responsePayload) responsePayload = await confirmRequestedAttendance(req, { tenantId, phone, text, session });
    if (!responsePayload) responsePayload = await continueBooking(req, { tenantId, phone, text, profileName, session });

    if (!responsePayload.bookingHandled) {
      const result = await callMavi(req, { tenantId, phone, text, profileName, session });
      const discovered = normalizeBooking(result.raw?.booking);
      if (discovered.status) session.booking = mergeBooking(session.booking, discovered);
      responsePayload = { reply: result.reply, appointment: null };
    }

    addHistory(session, "assistant", responsePayload.reply);
    await saveSession(tenantId, phone, session);
    await sendWhatsAppMessage(phone, responsePayload.reply, metadata.phoneNumberId);

    return jsonResponse(res, 200, {
      ok: true,
      tenantId,
      phoneNumberId: metadata.phoneNumberId || null,
      messageId,
      phone,
      booking: normalizeBooking(session.booking),
      reschedule: normalizeReschedule(session.reschedule),
      appointment: responsePayload.appointment || null,
      reply: responsePayload.reply
    });
  } catch (error) {
    console.error("MAVIRI WHATSAPP ERROR:", error);
    try {
      await sendWhatsAppMessage(phone, "Si è verificato un problema temporaneo. Riprova tra poco.", metadata.phoneNumberId);
    } catch (sendError) {
      console.error("WHATSAPP SEND ERROR:", sendError);
    }
    return jsonResponse(res, 500, { ok: false, tenantId, error: "Errore interno WhatsApp." });
  }
}