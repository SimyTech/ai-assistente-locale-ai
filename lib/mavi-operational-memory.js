const normalize = value => String(value || "")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9/:.\-\s]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const BOOKING_START = /(prenot|\bfissa\b|crea appunt|nuovo appunt)/;
const CANCEL = /(annulla|cancella|disdici|elimina)/;
const MOVE = /(sposta|rimanda|riprog|modifica)/;
const CONFIRM = /^(si|sì|confermo|ok|va bene|procedi)$/i;
const ACTIVE_STATUSES = new Set(["confirmed", "confermato", "pending", "scheduled", ""]);

function findNamed(items, message, field = "name") {
  const text = normalize(message);
  const matches = (Array.isArray(items) ? items : [])
    .filter(item => normalize(item?.[field]) && text.includes(normalize(item[field])))
    .sort((a, b) => normalize(b?.[field]).length - normalize(a?.[field]).length);
  return matches[0] || null;
}

function dateFragment(message) {
  const text = normalize(message);
  const relative = text.match(/\b(oggi|domani|dopodomani)\b/);
  if (relative) return relative[1];
  const weekday = text.match(/\b(lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica)\b/);
  if (weekday) return weekday[1];
  const numeric = text.match(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/);
  return numeric?.[0] || "";
}

function timeFragment(message) {
  const text = normalize(message);
  const explicit = text.match(/(?:alle|ore)\s*([01]?\d|2[0-3])(?:[:.]([0-5]\d))?\b/);
  if (explicit) return `${String(Number(explicit[1])).padStart(2, "0")}:${explicit[2] || "00"}`;
  if (/^\s*([01]?\d|2[0-3])(?:[:.]([0-5]\d))?\s*$/.test(text)) {
    const raw = text.match(/^\s*([01]?\d|2[0-3])(?:[:.]([0-5]\d))?\s*$/);
    return `${String(Number(raw[1])).padStart(2, "0")}:${raw[2] || "00"}`;
  }
  return "";
}

function activeAppointment(item) {
  return item && ACTIVE_STATUSES.has(normalize(item.status));
}

function appointmentLabel(item) {
  return [item?.name || "Cliente", item?.service || "servizio", item?.date || "data", item?.time || "ora"].join(" · ");
}

function appointmentCandidates(data, message) {
  const text = normalize(message);
  const namedClient = findNamed(data?.clients, message);
  const namedService = findNamed(data?.services, message);
  const date = dateFragment(message);
  const time = timeFragment(message);

  return (Array.isArray(data?.appointments) ? data.appointments : [])
    .filter(activeAppointment)
    .filter(item => !namedClient?.name || normalize(item?.name) === normalize(namedClient.name))
    .filter(item => !namedService?.name || normalize(item?.service) === normalize(namedService.name))
    .filter(item => !date || text.includes(normalize(item?.date)) || normalize(item?.date) === normalize(date))
    .filter(item => !time || normalize(item?.time) === normalize(time));
}

function missingQuestion(state) {
  if (!state.client) return "Per chi devo prenotare?";
  if (!state.service) return "Quale servizio devo prenotare?";
  if (!state.date) return "Per quale giorno?";
  if (!state.time) return "A che ora?";
  return "";
}

function canonicalBooking(state) {
  return `Prenota ${state.client} per ${state.service} ${state.date} alle ${state.time}`;
}

function targetQuestion(candidates) {
  if (!candidates.length) return "Non trovo un appuntamento corrispondente. Indicami cliente, giorno o orario.";
  if (candidates.length === 1) return "";
  return `Quale appuntamento intendi? ${candidates.slice(0, 4).map(appointmentLabel).join("; ")}`;
}

function moveMissingQuestion(state) {
  if (!state.target) return "Quale appuntamento devo spostare?";
  if (!state.newDate) return "A quale giorno devo spostarlo?";
  if (!state.newTime) return "A che ora devo spostarlo?";
  return "";
}

function cancellationConfirmation(state) {
  const target = state.target;
  return `Confermi l'annullamento dell'appuntamento di ${target.name || "Cliente"} del ${target.date} alle ${target.time}${target.service ? ` per ${target.service}` : ""}?`;
}

function moveConfirmation(state) {
  const target = state.target;
  return `Confermi lo spostamento dell'appuntamento di ${target.name || "Cliente"} dal ${target.date} alle ${target.time} a ${state.newDate} alle ${state.newTime}?`;
}

function canonicalCancellation(state) {
  const target = state.target;
  return `Confermo: annulla l'appuntamento di ${target.name || "Cliente"} del ${target.date} alle ${target.time}${target.service ? ` per ${target.service}` : ""}`;
}

function canonicalMove(state) {
  const target = state.target;
  return `Confermo: sposta l'appuntamento di ${target.name || "Cliente"} del ${target.date} alle ${target.time}${target.service ? ` per ${target.service}` : ""} a ${state.newDate} alle ${state.newTime}`;
}

export function createMaviOperationalMemory({ ttlMs = 5 * 60 * 1000 } = {}) {
  const sessions = new Map();

  function keyOf(conversationId) {
    return String(conversationId || "default").slice(0, 120);
  }

  function get(key, now) {
    const state = sessions.get(key);
    if (!state) return null;
    if (now - state.updatedAt > ttlMs) {
      sessions.delete(key);
      return null;
    }
    return state;
  }

  function clear(conversationId) {
    sessions.delete(keyOf(conversationId));
  }

  function prepareBooking(message, data, key, state, now) {
    const client = findNamed(data.clients, message);
    const service = findNamed(data.services, message);
    const date = dateFragment(message);
    const time = timeFragment(message);

    if (client?.name) state.client = String(client.name).trim();
    if (service?.name) state.service = String(service.name).trim();
    if (date) state.date = date;
    if (time) state.time = time;
    state.updatedAt = now;
    sessions.set(key, state);

    const missing = missingQuestion(state);
    if (missing) return { handled: true, answer: missing, pending: true, state: { ...state } };

    sessions.delete(key);
    return { handled: false, message: canonicalBooking(state), pending: false, completed: true, state: { ...state } };
  }

  function resolveTarget(state, data, message) {
    const candidates = appointmentCandidates(data, message);
    if (candidates.length === 1) state.target = { ...candidates[0] };
    return candidates;
  }

  function prepareCancellation(message, data, key, state, now) {
    if (!state.target) {
      const candidates = resolveTarget(state, data, message);
      const question = targetQuestion(candidates);
      if (question) {
        state.updatedAt = now;
        sessions.set(key, state);
        return { handled: true, answer: question, pending: true, state: { ...state } };
      }
    }

    if (!state.awaitingConfirm) {
      state.awaitingConfirm = true;
      state.updatedAt = now;
      sessions.set(key, state);
      return { handled: true, answer: cancellationConfirmation(state), pending: true, state: { ...state } };
    }

    if (CONFIRM.test(String(message || "").trim())) {
      sessions.delete(key);
      return { handled: false, message: canonicalCancellation(state), pending: false, completed: true, state: { ...state } };
    }

    return { handled: true, answer: cancellationConfirmation(state), pending: true, state: { ...state } };
  }

  function prepareMove(message, data, key, state, now) {
    if (!state.target) {
      const candidates = resolveTarget(state, data, message);
      const question = targetQuestion(candidates);
      if (question) {
        state.updatedAt = now;
        sessions.set(key, state);
        return { handled: true, answer: question, pending: true, state: { ...state } };
      }
    }

    const date = dateFragment(message);
    const time = timeFragment(message);
    if (date && date !== normalize(state.target?.date)) state.newDate = date;
    if (time && time !== normalize(state.target?.time)) state.newTime = time;

    const missing = moveMissingQuestion(state);
    if (missing) {
      state.updatedAt = now;
      sessions.set(key, state);
      return { handled: true, answer: missing, pending: true, state: { ...state } };
    }

    if (!state.awaitingConfirm) {
      state.awaitingConfirm = true;
      state.updatedAt = now;
      sessions.set(key, state);
      return { handled: true, answer: moveConfirmation(state), pending: true, state: { ...state } };
    }

    if (CONFIRM.test(String(message || "").trim())) {
      sessions.delete(key);
      return { handled: false, message: canonicalMove(state), pending: false, completed: true, state: { ...state } };
    }

    return { handled: true, answer: moveConfirmation(state), pending: true, state: { ...state } };
  }

  function prepare(message, data = {}, conversationId = "default", now = Date.now()) {
    const text = normalize(message);
    const key = keyOf(conversationId);
    let state = get(key, now);

    if (state?.kind === "cancel") return prepareCancellation(message, data, key, state, now);
    if (state?.kind === "move") return prepareMove(message, data, key, state, now);

    if (CANCEL.test(text)) {
      state = { kind: "cancel", target: null, awaitingConfirm: false, updatedAt: now };
      return prepareCancellation(message, data, key, state, now);
    }

    if (MOVE.test(text)) {
      state = { kind: "move", target: null, newDate: "", newTime: "", awaitingConfirm: false, updatedAt: now };
      return prepareMove(message, data, key, state, now);
    }

    if (CONFIRM.test(String(message || "").trim())) {
      return { handled: false, message, pending: Boolean(state) };
    }

    const startsBooking = BOOKING_START.test(text);
    if (!state && !startsBooking) return { handled: false, message, pending: false };

    if (!state) state = { kind: "book", client: "", service: "", date: "", time: "", updatedAt: now };
    return prepareBooking(message, data, key, state, now);
  }

  return { prepare, clear, has(conversationId, now = Date.now()) { return Boolean(get(keyOf(conversationId), now)); } };
}
