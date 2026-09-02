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
  const value = clean(text);
  if (!value || isCancellation(value)) return false;
  if (/\bnon\s+(?:conferm\w*|prenot\w*|proced\w*|accett\w*)\b/i.test(value)) return false;
  return /^(?:si|sì|ok|okay|confermo|conferma|confermato|va bene|perfetto|procedi|prenota|presente|ci sono|ci sar[oò])(?:\s|$|[,.!?])/i.test(value);
}

export function isCancellation(text) {
  const value = clean(text);
  if (!value) return false;
  return /(?:^|\s)(?:no|annulla|annullare|cancella|cancellare|stop|lascia perdere|non posso|non riesco|non vengo|non ci sono|non ci sar[oò]|devo annullare|vorrei annullare)(?:\s|$|[,.!?])/i.test(value);
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
