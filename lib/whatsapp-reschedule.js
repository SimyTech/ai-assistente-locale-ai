const clean = value => String(value ?? "").trim();
const norm = value => clean(value)
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/\s+/g, " ");

const WEEKDAYS = {
  domenica: 0,
  lunedi: 1,
  martedi: 2,
  mercoledi: 3,
  giovedi: 4,
  venerdi: 5,
  sabato: 6
};

function parseIso(value) {
  const match = clean(value).match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;

  return date;
}

function iso(date) {
  return date.toISOString().slice(0, 10);
}

function validTargetDate(candidate, base = "") {
  const target = parseIso(candidate);
  if (!target) return "";
  const today = parseIso(base);
  if (today && target.getTime() < today.getTime()) return "";
  return candidate;
}

function addDays(value, amount) {
  const date = parseIso(value);
  if (!date) return "";
  date.setUTCDate(date.getUTCDate() + amount);
  return iso(date);
}

function nextWeekday(value, target) {
  const date = parseIso(value);
  if (!date) return "";
  let delta = (target - date.getUTCDay() + 7) % 7;
  if (delta === 0) delta = 7;
  date.setUTCDate(date.getUTCDate() + delta);
  return iso(date);
}

export function isRescheduleRequest(text) {
  const value = norm(text);
  if (!value) return false;
  return /\b(?:sposta|spostare|sposterei|posticipa|posticipare|anticipa|anticipare|riprogramma|riprogrammare|modifica|modificare|cambia|cambiare)\b/.test(value)
    && /\b(?:appuntamento|prenotazione|visita|orario|giorno|data)\b/.test(value);
}

export function isRescheduleConfirmation(text) {
  const value = norm(text);
  if (!value || /\b(?:non|no)\s+(?:lo\s+)?conferm/.test(value)) return false;
  return /\bconferm(?:o|a|ato|ata|iamo)?\b/.test(value);
}

export function isRescheduleDecline(text) {
  const value = norm(text);
  if (!value) return false;
  if (extractRescheduleDate(value) || extractRescheduleTime(value)) return false;
  return /\b(?:mantieni|mantienilo|lascia\s+cosi|non\s+spostare|annulla\s+(?:lo\s+)?spostamento|lascia\s+l['’]?appuntamento|tieni\s+l['’]?appuntamento)\b/.test(value);
}

export function rescheduleConfirmationMessage(current = {}, target = {}) {
  return `Vuoi spostare ${clean(current.service)} dal ${clean(current.date)} alle ${clean(current.time)} al ${clean(target.date)} alle ${clean(target.time)}? Scrivi “confermo” oppure “mantieni”.`;
}

export function extractRescheduleDate(text, today = "") {
  const value = norm(text);
  const base = clean(today);

  const isoMatch = value.match(/\b(20\d{2})[-\/]([01]?\d)[-\/]([0-3]?\d)\b/);
  if (isoMatch) {
    const candidate = `${isoMatch[1]}-${String(Number(isoMatch[2])).padStart(2, "0")}-${String(Number(isoMatch[3])).padStart(2, "0")}`;
    return validTargetDate(candidate, base);
  }

  const localMatch = value.match(/\b([0-3]?\d)[\/]([01]?\d)(?:[\/](20\d{2}))?\b/);
  if (localMatch) {
    const year = localMatch[3] || base.slice(0, 4);
    if (!year) return "";
    const candidate = `${year}-${String(Number(localMatch[2])).padStart(2, "0")}-${String(Number(localMatch[1])).padStart(2, "0")}`;
    return validTargetDate(candidate, base);
  }

  if (!parseIso(base)) return "";
  if (/\bdopodomani\b/.test(value)) return addDays(base, 2);
  if (/\bdomani\b/.test(value)) return addDays(base, 1);
  if (/\boggi\b/.test(value)) return base;

  for (const [name, target] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b${name}\\b`).test(value)) return nextWeekday(base, target);
  }

  return "";
}

export function extractRescheduleTime(text) {
  const value = norm(text).replace(/\./g, ":");
  let match = value.match(/\b(?:alle|ore)\s+([01]?\d|2[0-3])(?::([0-5]\d))?\b/);
  if (!match) match = value.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (!match) return "";
  return `${String(Number(match[1])).padStart(2, "0")}:${String(match[2] || "00").padStart(2, "0")}`;
}

export function normalizeReschedule(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    status: clean(source.status),
    appointmentId: clean(source.appointmentId),
    date: clean(source.date),
    time: clean(source.time),
    candidates: Array.isArray(source.candidates) ? source.candidates.map(clean).filter(Boolean) : []
  };
}

export function selectCandidateByNumber(candidates = [], text = "") {
  const match = clean(text).match(/^\s*(\d{1,2})\s*[.)-]?\s*$/);
  if (!match) return "";
  const index = Number(match[1]) - 1;
  return index >= 0 && index < candidates.length ? clean(candidates[index]) : "";
}
