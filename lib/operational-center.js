const DAY_MS = 86400000;

function clean(value) {
  return String(value ?? "").trim();
}

function norm(value) {
  return clean(value).toLowerCase();
}

function toDateOnly(value) {
  const text = clean(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function parseMinutes(value) {
  const match = clean(value).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function minutesToTime(value) {
  const minutes = Math.max(0, Math.min(1439, Math.round(value)));
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function addDays(date, days) {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY_MS);
}

function appointmentDate(item) {
  return toDateOnly(item?.date || item?.day || item?.start || item?.startsAt);
}

function appointmentTime(item) {
  const direct = clean(item?.time || item?.startTime);
  if (/^\d{1,2}:\d{2}$/.test(direct)) return direct.padStart(5, "0");
  const source = clean(item?.start || item?.startsAt);
  const match = source.match(/T(\d{2}:\d{2})/);
  return match?.[1] || "";
}

function appointmentDuration(item, serviceByName) {
  const direct = Number(item?.duration || item?.durationMinutes || item?.minutes);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const service = serviceByName.get(norm(item?.service || item?.serviceName));
  const duration = Number(service?.duration || service?.durationMinutes || service?.minutes);
  return Number.isFinite(duration) && duration > 0 ? duration : 30;
}

function activeAppointment(item) {
  const status = norm(item?.status);
  return !["cancelled", "canceled", "annullato", "annullata", "deleted"].includes(status);
}

function completedAppointment(item) {
  return ["completed", "completato", "completata", "done"].includes(norm(item?.status));
}

function clientKey(item) {
  return clean(item?.clientId) || norm(item?.phone) || norm(item?.name || item?.clientName || item?.customerName);
}

function clientName(item, clientsById) {
  const direct = clean(item?.name || item?.clientName || item?.customerName);
  if (direct) return direct;
  return clean(clientsById.get(clean(item?.clientId))?.name);
}

function serviceName(item) {
  return clean(item?.service || item?.serviceName);
}

function servicePrice(item, serviceByName) {
  const direct = Number(item?.price ?? item?.amount);
  if (Number.isFinite(direct) && direct >= 0) return direct;
  const price = Number(serviceByName.get(norm(serviceName(item)))?.price);
  return Number.isFinite(price) && price >= 0 ? price : 0;
}

function normalizeDayHours(hours, date) {
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "Europe/Rome" })
    .format(new Date(`${date}T12:00:00Z`)).toLowerCase();
  const aliases = {
    mon: ["mon", "monday", "lun", "lunedi", "lunedì"],
    tue: ["tue", "tuesday", "mar", "martedi", "martedì"],
    wed: ["wed", "wednesday", "mer", "mercoledi", "mercoledì"],
    thu: ["thu", "thursday", "gio", "giovedi", "giovedì"],
    fri: ["fri", "friday", "ven", "venerdi", "venerdì"],
    sat: ["sat", "saturday", "sab", "sabato"],
    sun: ["sun", "sunday", "dom", "domenica"]
  };
  const key = Object.entries(aliases).find(([, values]) => values.includes(weekday))?.[0] || weekday;
  const source = hours?.[key] ?? Object.entries(hours || {}).find(([name]) => aliases[key]?.includes(norm(name)))?.[1];
  if (!source) return null;
  if (source === false || source?.closed === true) return null;
  const start = clean(source?.start || source?.open || source?.from || source?.[0]);
  const end = clean(source?.end || source?.close || source?.to || source?.[1]);
  if (!parseMinutes(start) && start !== "00:00") return null;
  if (!parseMinutes(end) && end !== "00:00") return null;
  return { start, end, breaks: Array.isArray(source?.breaks) ? source.breaks : [] };
}

export function findAgendaGaps(body = {}, options = {}) {
  const now = toDateOnly(options.now || new Date());
  const horizonDays = Math.max(1, Number(options.horizonDays) || 7);
  const minGapMinutes = Math.max(15, Number(options.minGapMinutes) || 30);
  const services = Array.isArray(body.services) ? body.services.filter(Boolean) : [];
  const serviceByName = new Map(services.map(service => [norm(service?.name), service]));
  const appointments = Array.isArray(body.appointments) ? body.appointments.filter(activeAppointment) : [];
  const gaps = [];

  for (let offset = 0; offset < horizonDays; offset += 1) {
    const date = addDays(now, offset);
    const day = normalizeDayHours(body.hours || body.business?.hours || {}, date);
    if (!day) continue;
    const open = parseMinutes(day.start);
    const close = parseMinutes(day.end);
    if (open === null || close === null || close <= open) continue;
    const busy = appointments
      .filter(item => appointmentDate(item) === date && appointmentTime(item))
      .map(item => {
        const start = parseMinutes(appointmentTime(item));
        return start === null ? null : [start, start + appointmentDuration(item, serviceByName)];
      })
      .filter(Boolean);
    for (const pause of day.breaks) {
      const start = parseMinutes(pause?.start || pause?.from || pause?.[0]);
      const end = parseMinutes(pause?.end || pause?.to || pause?.[1]);
      if (start !== null && end !== null && end > start) busy.push([start, end]);
    }
    busy.sort((a, b) => a[0] - b[0]);
    let cursor = open;
    for (const [start, end] of busy) {
      if (start > cursor && start - cursor >= minGapMinutes) {
        gaps.push({ type: "agenda-gap", date, start: minutesToTime(cursor), end: minutesToTime(start), minutes: start - cursor, priority: offset <= 1 ? "high" : "medium" });
      }
      cursor = Math.max(cursor, end);
    }
    if (close > cursor && close - cursor >= minGapMinutes) {
      gaps.push({ type: "agenda-gap", date, start: minutesToTime(cursor), end: minutesToTime(close), minutes: close - cursor, priority: offset <= 1 ? "high" : "medium" });
    }
  }
  return gaps.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}

export function findInactiveClients(body = {}, options = {}) {
  const today = toDateOnly(options.now || new Date());
  const inactiveDays = Math.max(30, Number(options.inactiveDays) || 90);
  const appointments = Array.isArray(body.appointments) ? body.appointments.filter(Boolean) : [];
  const clients = Array.isArray(body.clients) ? body.clients.filter(Boolean) : [];
  const clientsById = new Map(clients.map(client => [clean(client?.id), client]));
  const lastVisits = new Map();
  for (const item of appointments) {
    if (!completedAppointment(item)) continue;
    const date = appointmentDate(item);
    if (!date || date > today) continue;
    const key = clientKey(item);
    if (!key) continue;
    const current = lastVisits.get(key);
    if (!current || date > current.date) lastVisits.set(key, { date, item });
  }
  return [...lastVisits.entries()].flatMap(([key, row]) => {
    const days = daysBetween(row.date, today);
    if (days < inactiveDays) return [];
    const hasUpcoming = appointments.some(item => clientKey(item) === key && activeAppointment(item) && appointmentDate(item) >= today && !completedAppointment(item));
    if (hasUpcoming) return [];
    return [{ type: "inactive-client", clientId: clean(row.item?.clientId), name: clientName(row.item, clientsById), lastVisit: row.date, inactiveDays: days, service: serviceName(row.item), priority: days >= inactiveDays * 2 ? "high" : "medium" }];
  }).sort((a, b) => b.inactiveDays - a.inactiveDays);
}

export function findCancellationRecovery(body = {}, options = {}) {
  const today = toDateOnly(options.now || new Date());
  const lookbackDays = Math.max(1, Number(options.lookbackDays) || 30);
  const services = Array.isArray(body.services) ? body.services.filter(Boolean) : [];
  const serviceByName = new Map(services.map(service => [norm(service?.name), service]));
  const appointments = Array.isArray(body.appointments) ? body.appointments.filter(Boolean) : [];
  const lowerBound = addDays(today, -lookbackDays);
  return appointments.flatMap(item => {
    const status = norm(item?.status);
    const date = appointmentDate(item);
    if (!["cancelled", "canceled", "annullato", "annullata"].includes(status) || !date || date < lowerBound || date > today) return [];
    const key = clientKey(item);
    const hasRecovered = appointments.some(other => other !== item && clientKey(other) === key && activeAppointment(other) && appointmentDate(other) > date);
    if (hasRecovered) return [];
    return [{ type: "cancellation-recovery", clientId: clean(item?.clientId), name: clean(item?.name || item?.clientName || item?.customerName), cancelledDate: date, service: serviceName(item), value: servicePrice(item, serviceByName), priority: "high" }];
  }).sort((a, b) => b.cancelledDate.localeCompare(a.cancelledDate));
}

export function buildOperationalCenter(body = {}, options = {}) {
  const gaps = findAgendaGaps(body, options);
  const inactiveClients = findInactiveClients(body, options);
  const cancellations = findCancellationRecovery(body, options);
  const actions = [
    ...cancellations.map(item => ({ ...item, action: "recontact", label: item.name ? `Ricontatta ${item.name}` : "Recupera cancellazione" })),
    ...inactiveClients.map(item => ({ ...item, action: "reactivate", label: item.name ? `Riattiva ${item.name}` : "Riattiva cliente" })),
    ...gaps.map(item => ({ ...item, action: "fill-gap", label: `Riempi il buco ${item.date} ${item.start}–${item.end}` }))
  ];
  const priorityRank = { high: 0, medium: 1, low: 2 };
  actions.sort((a, b) => (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9));
  return {
    generatedAt: new Date(options.now || Date.now()).toISOString(),
    summary: {
      totalActions: actions.length,
      agendaGaps: gaps.length,
      inactiveClients: inactiveClients.length,
      cancellationRecoveries: cancellations.length,
      recoverableValue: cancellations.reduce((sum, item) => sum + item.value, 0)
    },
    actions
  };
}
