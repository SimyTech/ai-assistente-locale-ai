import { clientOwnsAppointment } from "./auth.js";

const clean = value => String(value ?? "").trim();
const norm = value => clean(value)
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/\s+/g, " ");

export function listClientAppointments(appointments = [], identity = {}, today = "") {
  const threshold = clean(today);
  return (Array.isArray(appointments) ? appointments : [])
    .filter(appointment => {
      const status = clean(appointment?.status || "confirmed").toLowerCase();
      if (status !== "confirmed") return false;
      const date = clean(appointment?.date);
      if (!date || (threshold && date < threshold)) return false;
      return clientOwnsAppointment(appointment, identity);
    })
    .sort((a, b) => `${clean(a?.date)} ${clean(a?.time)}`.localeCompare(`${clean(b?.date)} ${clean(b?.time)}`));
}

function explicitTimes(text) {
  const source = norm(text).replace(/\./g, ":");
  const result = new Set();
  for (const match of source.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)) {
    result.add(`${String(Number(match[1])).padStart(2, "0")}:${match[2]}`);
  }
  for (const match of source.matchAll(/\b(?:alle|ore)\s+([01]?\d|2[0-3])\b/g)) {
    result.add(`${String(Number(match[1])).padStart(2, "0")}:00`);
  }
  return [...result];
}

function explicitDates(text) {
  const source = norm(text);
  const result = new Set();
  for (const match of source.matchAll(/\b(20\d{2})[-\/]([01]?\d)[-\/]([0-3]?\d)\b/g)) {
    result.add(`${match[1]}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}`);
  }
  for (const match of source.matchAll(/\b([0-3]?\d)[\/]([01]?\d)(?:[\/](20\d{2}))?\b/g)) {
    const year = match[3] || "";
    if (year) result.add(`${year}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[1])).padStart(2, "0")}`);
  }
  return [...result];
}

export function resolveClientCancellation(appointments = [], identity = {}, today = "", text = "") {
  const matches = listClientAppointments(appointments, identity, today);
  if (matches.length === 0) return { appointment: null, matches: [], ambiguous: false };
  if (matches.length === 1) return { appointment: matches[0], matches, ambiguous: false };

  let candidates = matches;
  const dates = explicitDates(text);
  if (dates.length) candidates = candidates.filter(item => dates.includes(clean(item?.date)));

  const times = explicitTimes(text);
  if (times.length) candidates = candidates.filter(item => times.includes(clean(item?.time)));

  const message = norm(text);
  const serviceMatches = candidates.filter(item => {
    const service = norm(item?.service);
    return service.length >= 3 && message.includes(service);
  });
  if (serviceMatches.length === 1) candidates = serviceMatches;

  if (candidates.length === 1) {
    return { appointment: candidates[0], matches, ambiguous: false };
  }
  return { appointment: null, matches, ambiguous: true };
}

export function pickNextClientAppointment(appointments = [], identity = {}, today = "") {
  const matches = listClientAppointments(appointments, identity, today);
  return matches.length === 1 ? matches[0] : null;
}
