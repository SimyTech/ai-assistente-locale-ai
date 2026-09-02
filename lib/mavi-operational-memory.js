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

  function prepare(message, data = {}, conversationId = "default", now = Date.now()) {
    const text = normalize(message);
    const key = keyOf(conversationId);
    let state = get(key, now);

    if (CANCEL.test(text) || MOVE.test(text) || CONFIRM.test(String(message || "").trim())) {
      return { handled: false, message, pending: Boolean(state) };
    }

    const startsBooking = BOOKING_START.test(text);
    if (!state && !startsBooking) return { handled: false, message, pending: false };

    if (!state) state = { kind: "book", client: "", service: "", date: "", time: "", updatedAt: now };

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
    return {
      handled: false,
      message: canonicalBooking(state),
      pending: false,
      completed: true,
      state: { ...state }
    };
  }

  return { prepare, clear, has(conversationId, now = Date.now()) { return Boolean(get(keyOf(conversationId), now)); } };
}
