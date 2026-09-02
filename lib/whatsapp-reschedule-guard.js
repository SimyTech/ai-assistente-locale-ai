import { resolveWhatsAppTenant, whatsappMetadata, whatsappProcessedKey, whatsappSessionKey } from "./whatsapp-tenant.js";
import { tenantDataKey } from "./tenant.js";
import { listClientAppointments } from "./whatsapp-cancellation.js";
import {
  extractRescheduleDate,
  extractRescheduleTime,
  isRescheduleConfirmation,
  isRescheduleDecline,
  isRescheduleRequest,
  rescheduleConfirmationMessage,
  selectCandidateByNumber
} from "./whatsapp-reschedule.js";

const clean = value => String(value ?? "").replace(/\u0000/g, "").trim();
const PROCESSED_TTL = 1000 * 60 * 60 * 24;

const redisUrl = () => process.env.UPSTASH_REDIS_REST_URL || "";
const redisToken = () => process.env.UPSTASH_REDIS_REST_TOKEN || "";

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

function todayRome() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function extractIncoming(body) {
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value;
      for (const message of Array.isArray(value?.messages) ? value.messages : []) {
        if (message?.type !== "text") continue;
        const phone = clean(message?.from);
        const text = clean(message?.text?.body);
        if (!phone || !text) continue;
        return { phone, text, messageId: clean(message?.id) };
      }
    }
  }
  return null;
}

export function normalizePendingReschedule(value) {
  const source = value && typeof value === "object" ? value : {};
  const result = {
    status: clean(source.status),
    appointmentId: clean(source.appointmentId),
    date: clean(source.date),
    time: clean(source.time),
    requestedAt: clean(source.requestedAt)
  };
  const candidates = [...new Set((Array.isArray(source.candidates) ? source.candidates : []).map(clean).filter(Boolean))].slice(0, 5);
  if (candidates.length) result.candidates = candidates;
  return result;
}

export function selectedRescheduleState(pending, appointmentId) {
  const current = normalizePendingReschedule(pending);
  return {
    status: current.date ? (current.time ? "checking-availability" : "collecting-time") : "collecting-date",
    appointmentId: clean(appointmentId),
    date: current.date,
    time: current.time,
    requestedAt: current.requestedAt || new Date().toISOString()
  };
}

function appointmentLabel(appointment, index = null) {
  const prefix = index === null ? "" : `${index + 1}) `;
  return `${prefix}${clean(appointment?.date)} alle ${clean(appointment?.time)} — ${clean(appointment?.service)}`;
}

function originFor(req) {
  return `${req.headers?.["x-forwarded-proto"] || "https"}://${req.headers?.["x-forwarded-host"] || req.headers?.host}`;
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

async function sendWhatsApp(to, message, phoneNumberId) {
  const token = clean(process.env.WHATSAPP_ACCESS_TOKEN);
  const senderId = clean(phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID);
  if (!token || !senderId) throw new Error("WhatsApp Cloud API non configurata.");
  const response = await fetch(`https://graph.facebook.com/v23.0/${senderId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: clean(to), type: "text", text: { preview_url: false, body: clean(message) } })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `WhatsApp HTTP ${response.status}`);
  return payload;
}

async function respond(res, { tenantId, phone, messageId, reply, duplicate = false, appointment = null }, phoneNumberId) {
  if (!duplicate) await sendWhatsApp(phone, reply, phoneNumberId);
  return res.status(200).json({ ok: true, safeReschedule: true, duplicate, tenantId, messageId, phone, appointment, reply });
}

async function markProcessed(tenantId, phone, messageId) {
  if (!messageId) return;
  await redisSet(whatsappProcessedKey(tenantId, messageId), { tenantId, phone, messageId }, PROCESSED_TTL);
}

async function savePending(sessionKey, session, pending) {
  await redisSet(sessionKey, { ...session, pendingReschedule: pending });
}

async function clearPending(sessionKey, session) {
  const nextSession = { ...session };
  delete nextSession.pendingReschedule;
  await redisSet(sessionKey, nextSession);
}

async function availability(req, tenantId, appointment, date) {
  const result = await businessApi(req, tenantId, {
    action: "availability",
    date,
    service: appointment.service
  });
  return Array.isArray(result.slots) ? result.slots : [];
}

async function requestConfirmation({ req, res, tenantId, metadata, phone, messageId, sessionKey, session, appointment, pending }) {
  const slots = await availability(req, tenantId, appointment, pending.date);
  if (!slots.includes(pending.time)) {
    const next = { ...pending, status: "collecting-time", time: "" };
    await savePending(sessionKey, session, next);
    await markProcessed(tenantId, phone, messageId);
    return respond(res, {
      tenantId, phone, messageId,
      reply: slots.length
        ? `Quell’orario non è disponibile. Per il ${pending.date} puoi scegliere: ${slots.join(", ")}.`
        : `Per il ${pending.date} non risultano orari disponibili. Indicami un altro giorno.`
    }, metadata.phoneNumberId);
  }

  const next = { ...pending, status: "awaiting-confirmation" };
  await savePending(sessionKey, session, next);
  await markProcessed(tenantId, phone, messageId);
  return respond(res, {
    tenantId, phone, messageId,
    reply: rescheduleConfirmationMessage(appointment, next)
  }, metadata.phoneNumberId);
}

export async function handleSafeReschedule(req, res) {
  const incoming = extractIncoming(req.body);
  if (!incoming) return false;

  const tenantId = resolveWhatsAppTenant(req.body);
  const metadata = whatsappMetadata(req.body);
  const { phone, text, messageId } = incoming;
  const sessionKey = whatsappSessionKey(tenantId, phone);
  const session = (await redisGet(sessionKey)) || {};
  const pending = normalizePendingReschedule(session?.pendingReschedule);
  const bookingActive = Boolean(clean(session?.booking?.status));

  if (!pending.status && bookingActive) return false;
  if (!pending.status && !isRescheduleRequest(text)) return false;

  const processedKey = messageId ? whatsappProcessedKey(tenantId, messageId) : "";
  if (processedKey && await redisGet(processedKey)) {
    return respond(res, { tenantId, phone, messageId, reply: "", duplicate: true }, metadata.phoneNumberId);
  }

  const dataKey = tenantDataKey(tenantId);
  const data = await redisGet(dataKey);
  if (!data || typeof data !== "object") return false;
  const appointments = Array.isArray(data.appointments) ? data.appointments : [];
  const owned = listClientAppointments(appointments, { phone, whatsapp: phone }, todayRome());
  const byId = new Map(owned.map(item => [String(item.id), item]));

  if (pending.status) {
    const appointment = byId.get(pending.appointmentId);
    if (pending.status === "selecting-appointment") {
      if (isRescheduleDecline(text)) {
        await clearPending(sessionKey, session);
        await markProcessed(tenantId, phone, messageId);
        return respond(res, { tenantId, phone, messageId, reply: "Va bene, non sposto nessun appuntamento." }, metadata.phoneNumberId);
      }
      const selectedId = selectCandidateByNumber(pending.candidates, text);
      const selected = byId.get(String(selectedId));
      if (!selected) {
        const options = (pending.candidates || []).map((id, index) => appointmentLabel(byId.get(String(id)) || {}, index)).join("; ");
        await markProcessed(tenantId, phone, messageId);
        return respond(res, { tenantId, phone, messageId, reply: `Indicami il numero dell’appuntamento da spostare: ${options}.` }, metadata.phoneNumberId);
      }

      const next = selectedRescheduleState(pending, selected.id);
      if (!next.date) {
        await savePending(sessionKey, session, next);
        await markProcessed(tenantId, phone, messageId);
        return respond(res, { tenantId, phone, messageId, reply: `A quale giorno vuoi spostare ${appointmentLabel(selected)}?` }, metadata.phoneNumberId);
      }

      if (!next.time) {
        const slots = await availability(req, tenantId, selected, next.date);
        await savePending(sessionKey, session, next);
        await markProcessed(tenantId, phone, messageId);
        return respond(res, {
          tenantId, phone, messageId,
          reply: slots.length
            ? `Per il ${next.date} sono disponibili: ${slots.join(", ")}. Quale orario preferisci?`
            : `Per il ${next.date} non risultano orari disponibili. Indicami un altro giorno.`
        }, metadata.phoneNumberId);
      }

      return requestConfirmation({ req, res, tenantId, metadata, phone, messageId, sessionKey, session, appointment: selected, pending: next });
    }

    if (!appointment) {
      await clearPending(sessionKey, session);
      await markProcessed(tenantId, phone, messageId);
      return respond(res, { tenantId, phone, messageId, reply: "Non trovo più l’appuntamento da spostare. Potrebbe essere già stato modificato o annullato." }, metadata.phoneNumberId);
    }

    if (isRescheduleDecline(text)) {
      await clearPending(sessionKey, session);
      await markProcessed(tenantId, phone, messageId);
      return respond(res, { tenantId, phone, messageId, reply: `Va bene, mantengo ${appointmentLabel(appointment)}.` }, metadata.phoneNumberId);
    }

    const requestedDate = extractRescheduleDate(text, todayRome());
    const requestedTime = extractRescheduleTime(text);
    const correction = Boolean(requestedDate || requestedTime);
    let next = { ...pending };
    if (requestedDate) {
      next.date = requestedDate;
      if (!requestedTime) next.time = "";
    }
    if (requestedTime) next.time = requestedTime;

    if (pending.status === "awaiting-confirmation" && isRescheduleConfirmation(text) && !correction) {
      try {
        const result = await businessApi(req, tenantId, {
          action: "update",
          id: appointment.id,
          date: pending.date,
          time: pending.time,
          service: appointment.service,
          name: appointment.name,
          phone,
          whatsapp: phone,
          email: appointment.email,
          notes: appointment.notes,
          status: appointment.status || "confirmed"
        });
        await clearPending(sessionKey, session);
        await markProcessed(tenantId, phone, messageId);
        return respond(res, {
          tenantId, phone, messageId,
          reply: `Fatto. Ho spostato l’appuntamento di ${clean(appointment.service)} al ${clean(result.appointment?.date || pending.date)} alle ${clean(result.appointment?.time || pending.time)}.`,
          appointment: result.appointment || null
        }, metadata.phoneNumberId);
      } catch (error) {
        if (Number(error.status) === 409) {
          const slots = Array.isArray(error.payload?.availableSlots) ? error.payload.availableSlots : [];
          next = { ...pending, status: "collecting-time", time: "" };
          await savePending(sessionKey, session, next);
          await markProcessed(tenantId, phone, messageId);
          return respond(res, {
            tenantId, phone, messageId,
            reply: slots.length
              ? `Quell’orario non è più disponibile. Per il ${pending.date} puoi scegliere: ${slots.join(", ")}.`
              : "Quell’orario non è più disponibile. Indicami un altro giorno o orario."
          }, metadata.phoneNumberId);
        }
        throw error;
      }
    }

    if (!next.date) {
      next.status = "collecting-date";
      await savePending(sessionKey, session, next);
      await markProcessed(tenantId, phone, messageId);
      return respond(res, { tenantId, phone, messageId, reply: "A quale giorno vuoi spostare l’appuntamento?" }, metadata.phoneNumberId);
    }

    if (!next.time) {
      next.status = "collecting-time";
      const slots = await availability(req, tenantId, appointment, next.date);
      await savePending(sessionKey, session, next);
      await markProcessed(tenantId, phone, messageId);
      return respond(res, {
        tenantId, phone, messageId,
        reply: slots.length
          ? `Per il ${next.date} sono disponibili: ${slots.join(", ")}. Quale orario preferisci?`
          : `Per il ${next.date} non risultano orari disponibili. Indicami un altro giorno.`
      }, metadata.phoneNumberId);
    }

    return requestConfirmation({ req, res, tenantId, metadata, phone, messageId, sessionKey, session, appointment, pending: next });
  }

  if (!owned.length) {
    await markProcessed(tenantId, phone, messageId);
    return respond(res, { tenantId, phone, messageId, reply: "Non risultano appuntamenti futuri da spostare per questo numero WhatsApp." }, metadata.phoneNumberId);
  }

  if (owned.length > 1) {
    const candidates = owned.slice(0, 5);
    await savePending(sessionKey, session, {
      status: "selecting-appointment",
      appointmentId: "",
      date: extractRescheduleDate(text, todayRome()),
      time: extractRescheduleTime(text),
      requestedAt: new Date().toISOString(),
      candidates: candidates.map(item => String(item.id))
    });
    await markProcessed(tenantId, phone, messageId);
    return respond(res, {
      tenantId, phone, messageId,
      reply: `Quale appuntamento vuoi spostare? Rispondi con il numero: ${candidates.map((item, index) => appointmentLabel(item, index)).join("; ")}.`
    }, metadata.phoneNumberId);
  }

  const appointment = owned[0];
  const next = {
    status: "collecting-date",
    appointmentId: String(appointment.id),
    date: extractRescheduleDate(text, todayRome()),
    time: extractRescheduleTime(text),
    requestedAt: new Date().toISOString()
  };

  if (!next.date) {
    await savePending(sessionKey, session, next);
    await markProcessed(tenantId, phone, messageId);
    return respond(res, { tenantId, phone, messageId, reply: `A quale giorno vuoi spostare ${appointmentLabel(appointment)}?` }, metadata.phoneNumberId);
  }

  if (!next.time) {
    next.status = "collecting-time";
    const slots = await availability(req, tenantId, appointment, next.date);
    await savePending(sessionKey, session, next);
    await markProcessed(tenantId, phone, messageId);
    return respond(res, {
      tenantId, phone, messageId,
      reply: slots.length
        ? `Per il ${next.date} sono disponibili: ${slots.join(", ")}. Quale orario preferisci?`
        : `Per il ${next.date} non risultano orari disponibili. Indicami un altro giorno.`
    }, metadata.phoneNumberId);
  }

  return requestConfirmation({ req, res, tenantId, metadata, phone, messageId, sessionKey, session, appointment, pending: next });
}
