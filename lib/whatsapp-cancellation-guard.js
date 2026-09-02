import { resolveWhatsAppTenant, whatsappMetadata, whatsappProcessedKey, whatsappSessionKey } from "./whatsapp-tenant.js";
import { tenantDataKey } from "./tenant.js";
import { listClientAppointments, resolveClientCancellation } from "./whatsapp-cancellation.js";
import { isCancellation, isConfirmation } from "./whatsapp-booking.js";

const clean = value => String(value ?? "").replace(/\u0000/g, "").trim();
const norm = value => clean(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
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

export function normalizePendingCancellation(value) {
  const source = value && typeof value === "object" ? value : {};
  const result = {
    status: clean(source.status),
    appointmentId: clean(source.appointmentId),
    requestedAt: clean(source.requestedAt)
  };
  const candidates = [...new Set((Array.isArray(source.candidates) ? source.candidates : []).map(clean).filter(Boolean))].slice(0, 5);
  if (candidates.length) result.candidates = candidates;
  return result;
}

export function isCancellationDecline(text) {
  const value = norm(text);
  return /^(?:(?:ok|va bene)[, ]+)?(?:no|no grazie|lascia|mantieni|mantienilo|non annullare|non cancellare|lascia stare|conserva)(?:[,.! ]+grazie)?$/.test(value);
}

export function narrowCancellationCandidates(appointments, candidateIds, text, today, identity) {
  const allowed = new Set((Array.isArray(candidateIds) ? candidateIds : []).map(String));
  if (!allowed.size) return null;
  const candidates = (Array.isArray(appointments) ? appointments : []).filter(item => allowed.has(String(item?.id)));
  return resolveClientCancellation(candidates, identity, today, text).appointment || null;
}

function appointmentLabel(appointment) {
  return `${clean(appointment?.date)} alle ${clean(appointment?.time)} — ${clean(appointment?.service)}`;
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
  return res.status(200).json({ ok: true, safeCancellation: true, duplicate, tenantId, messageId, phone, appointment, reply });
}

async function markProcessed(tenantId, phone, messageId) {
  if (!messageId) return;
  await redisSet(whatsappProcessedKey(tenantId, messageId), { tenantId, phone, messageId }, PROCESSED_TTL);
}

async function clearPending(sessionKey, session) {
  const nextSession = { ...session };
  delete nextSession.pendingCancellation;
  await redisSet(sessionKey, nextSession);
}

export async function handleSafeCancellation(req, res) {
  const incoming = extractIncoming(req.body);
  if (!incoming) return false;

  const tenantId = resolveWhatsAppTenant(req.body);
  const metadata = whatsappMetadata(req.body);
  const { phone, text, messageId } = incoming;
  const processedKey = messageId ? whatsappProcessedKey(tenantId, messageId) : "";
  if (processedKey && await redisGet(processedKey)) {
    return respond(res, { tenantId, phone, messageId, reply: "", duplicate: true }, metadata.phoneNumberId);
  }

  const sessionKey = whatsappSessionKey(tenantId, phone);
  const session = (await redisGet(sessionKey)) || {};
  const bookingActive = Boolean(clean(session?.booking?.status));
  const rescheduleActive = Boolean(clean(session?.reschedule?.status));
  const pending = normalizePendingCancellation(session?.pendingCancellation);

  if (!pending.status && (bookingActive || rescheduleActive)) return false;
  if (!pending.status && !isCancellation(text)) return false;

  const dataKey = tenantDataKey(tenantId);
  const data = await redisGet(dataKey);
  if (!data || typeof data !== "object") return false;
  const appointments = Array.isArray(data.appointments) ? data.appointments : [];
  const identity = { phone, whatsapp: phone };
  const today = todayRome();
  const owned = listClientAppointments(appointments, identity, today);

  if (pending.status === "selecting-appointment") {
    if (isCancellationDecline(text)) {
      await clearPending(sessionKey, session);
      await markProcessed(tenantId, phone, messageId);
      return respond(res, { tenantId, phone, messageId, reply: "Va bene, non annullo nessun appuntamento." }, metadata.phoneNumberId);
    }

    const selected = narrowCancellationCandidates(appointments, pending.candidates, text, today, identity);
    if (!selected) {
      const allowed = new Set((pending.candidates || []).map(String));
      const options = owned.filter(item => allowed.has(String(item.id))).map(appointmentLabel).join("; ");
      await markProcessed(tenantId, phone, messageId);
      return respond(res, {
        tenantId, phone, messageId,
        reply: `Non riesco ancora a capire quale appuntamento. Scegli tra: ${options}. Puoi indicare giorno, orario o servizio.`
      }, metadata.phoneNumberId);
    }

    await redisSet(sessionKey, {
      ...session,
      pendingCancellation: {
        status: "awaiting-confirmation",
        appointmentId: String(selected.id),
        requestedAt: pending.requestedAt || new Date().toISOString()
      }
    });
    await markProcessed(tenantId, phone, messageId);
    return respond(res, {
      tenantId, phone, messageId,
      reply: `Confermi l’annullamento dell’appuntamento del ${appointmentLabel(selected)}? Scrivi “confermo” oppure “mantieni”.`
    }, metadata.phoneNumberId);
  }

  if (pending.status === "awaiting-confirmation") {
    const appointment = owned.find(item => String(item?.id) === pending.appointmentId);
    if (!appointment) {
      await clearPending(sessionKey, session);
      await markProcessed(tenantId, phone, messageId);
      return respond(res, { tenantId, phone, messageId, reply: "Non trovo più l’appuntamento da annullare. Potrebbe essere già stato modificato o annullato." }, metadata.phoneNumberId);
    }

    if (isCancellationDecline(text)) {
      await clearPending(sessionKey, session);
      await markProcessed(tenantId, phone, messageId);
      return respond(res, { tenantId, phone, messageId, reply: `Va bene, mantengo il tuo appuntamento del ${appointmentLabel(appointment)}.` }, metadata.phoneNumberId);
    }

    if (!isConfirmation(text)) {
      await markProcessed(tenantId, phone, messageId);
      return respond(res, { tenantId, phone, messageId, reply: `Confermi l’annullamento dell’appuntamento del ${appointmentLabel(appointment)}? Scrivi “confermo” oppure “mantieni”.` }, metadata.phoneNumberId);
    }

    const cancelledAt = new Date().toISOString();
    const cancelled = { ...appointment, status: "cancelled", cancelledAt, cancellationReason: "Annullato dal cliente via WhatsApp", updatedAt: cancelledAt };
    const nextAppointments = appointments.map(item => String(item?.id) === String(appointment.id) ? cancelled : item);
    await redisSet(dataKey, { ...data, appointments: nextAppointments, revision: Number(data.revision || 0) + 1, updatedAt: cancelledAt });
    await clearPending(sessionKey, session);
    await markProcessed(tenantId, phone, messageId);
    return respond(res, { tenantId, phone, messageId, reply: `Fatto. Ho annullato il tuo appuntamento del ${appointmentLabel(appointment)}.`, appointment: cancelled }, metadata.phoneNumberId);
  }

  const resolution = resolveClientCancellation(appointments, identity, today, text);
  if (!resolution.matches.length) return false;

  if (!resolution.appointment) {
    const candidates = resolution.matches.slice(0, 5);
    await redisSet(sessionKey, {
      ...session,
      pendingCancellation: {
        status: "selecting-appointment",
        appointmentId: "",
        requestedAt: new Date().toISOString(),
        candidates: candidates.map(item => String(item.id))
      }
    });
    await markProcessed(tenantId, phone, messageId);
    return respond(res, {
      tenantId, phone, messageId,
      reply: `Hai più appuntamenti futuri: ${candidates.map(appointmentLabel).join("; ")}. Quale vuoi annullare? Indica giorno, orario o servizio.`
    }, metadata.phoneNumberId);
  }

  const appointment = resolution.appointment;
  await redisSet(sessionKey, {
    ...session,
    pendingCancellation: { status: "awaiting-confirmation", appointmentId: String(appointment.id), requestedAt: new Date().toISOString() }
  });
  await markProcessed(tenantId, phone, messageId);
  return respond(res, { tenantId, phone, messageId, reply: `Confermi l’annullamento dell’appuntamento del ${appointmentLabel(appointment)}? Scrivi “confermo” oppure “mantieni”.` }, metadata.phoneNumberId);
}
