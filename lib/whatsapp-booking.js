const clean = value => String(value ?? "").trim();

export function normalizeBooking(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    status: clean(source.status),
    service: clean(source.service),
    date: clean(source.date),
    time: clean(source.time),
    name: clean(source.name)
  };
}

export function mergeBooking(current = {}, incoming = {}) {
  const a = normalizeBooking(current);
  const b = normalizeBooking(incoming);
  return {
    status: b.status || a.status,
    service: b.service || a.service,
    date: b.date || a.date,
    time: b.time || a.time,
    name: b.name || a.name
  };
}

export function extractTime(text) {
  const value = clean(text).replace(/[.]/g, ":");
  const match = value.match(/\b([01]?\d|2[0-3])(?::([0-5]\d))\b/);
  if (!match) return "";
  return `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`;
}

export function isConfirmation(text) {
  return /^(si|sì|ok|okay|confermo|conferma|va bene|perfetto|procedi|prenota)\b/i.test(clean(text));
}

export function isCancellation(text) {
  return /\b(no|annulla|annullare|cancella|cancellare|stop|lascia perdere)\b/i.test(clean(text));
}

export function bookingComplete(booking = {}) {
  const b = normalizeBooking(booking);
  return Boolean(b.service && b.date && b.time && b.name);
}

export function bookingSummary(booking = {}) {
  const b = normalizeBooking(booking);
  return `${b.service} il ${b.date} alle ${b.time} per ${b.name}`;
}

export function awaitingField(booking = {}) {
  const b = normalizeBooking(booking);
  if (!b.service) return "service";
  if (!b.date) return "date";
  if (!b.time) return "time";
  if (!b.name) return "name";
  return "confirmation";
}
