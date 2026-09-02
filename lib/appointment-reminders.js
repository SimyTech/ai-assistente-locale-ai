const clean = value => String(value ?? "").trim();

const DEFAULT_RULES = [
  { id: "day-before", leadMinutes: 24 * 60, toleranceMinutes: 30 },
  { id: "imminent", leadMinutes: 2 * 60, toleranceMinutes: 15 }
];

function parseLocalDateTime(date, time) {
  const dateMatch = clean(date).match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  const timeMatch = clean(time).match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!dateMatch || !timeMatch) return null;
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const value = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const check = new Date(value);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute
  ) return null;
  return value;
}

export function romeLocalNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`
  };
}

export function reminderKey(appointment, ruleId) {
  return [
    clean(appointment?.id),
    clean(appointment?.date),
    clean(appointment?.time),
    clean(ruleId)
  ].join("|");
}

export function normalizeReminderState(value) {
  const source = value && typeof value === "object" ? value : {};
  const sent = source.sent && typeof source.sent === "object" ? source.sent : {};
  return { sent: { ...sent } };
}

export function reminderMessage(appointment, ruleId) {
  const service = clean(appointment?.service) || "appuntamento";
  const date = clean(appointment?.date);
  const time = clean(appointment?.time);
  if (ruleId === "imminent") {
    return `Promemoria Maviri: il tuo appuntamento per ${service} è oggi alle ${time}. Ti aspettiamo!`;
  }
  return `Promemoria Maviri: hai un appuntamento per ${service} il ${date} alle ${time}.`;
}

export function planAppointmentReminders({ appointments = [], state = {}, now = new Date(), rules = DEFAULT_RULES } = {}) {
  const reminderState = normalizeReminderState(state);
  const localNow = romeLocalNow(now);
  const nowValue = parseLocalDateTime(localNow.date, localNow.time);
  if (nowValue === null) return { due: [], state: reminderState };

  const due = [];
  for (const appointment of Array.isArray(appointments) ? appointments : []) {
    const status = clean(appointment?.status || "confirmed").toLowerCase();
    if (status !== "confirmed") continue;
    const appointmentValue = parseLocalDateTime(appointment?.date, appointment?.time);
    if (appointmentValue === null || appointmentValue <= nowValue) continue;
    const recipient = clean(appointment?.whatsapp || appointment?.phone);
    if (!recipient) continue;

    const minutesUntil = Math.round((appointmentValue - nowValue) / 60000);
    for (const rule of Array.isArray(rules) ? rules : DEFAULT_RULES) {
      const id = clean(rule?.id);
      const leadMinutes = Number(rule?.leadMinutes);
      const toleranceMinutes = Math.max(0, Number(rule?.toleranceMinutes || 0));
      if (!id || !Number.isFinite(leadMinutes)) continue;
      if (Math.abs(minutesUntil - leadMinutes) > toleranceMinutes) continue;

      const key = reminderKey(appointment, id);
      if (reminderState.sent[key]) continue;
      due.push({
        key,
        ruleId: id,
        appointmentId: clean(appointment?.id),
        tenantId: clean(appointment?.tenantId),
        recipient,
        date: clean(appointment?.date),
        time: clean(appointment?.time),
        service: clean(appointment?.service),
        minutesUntil,
        message: reminderMessage(appointment, id)
      });
    }
  }

  due.sort((a, b) => a.minutesUntil - b.minutesUntil || a.key.localeCompare(b.key));
  return { due, state: reminderState };
}

export function markReminderSent(state, reminder, sentAt = new Date().toISOString()) {
  const next = normalizeReminderState(state);
  const key = clean(reminder?.key);
  if (!key) return next;
  next.sent[key] = {
    sentAt: clean(sentAt),
    ruleId: clean(reminder?.ruleId),
    appointmentId: clean(reminder?.appointmentId)
  };
  return next;
}

export function pruneReminderState(state, appointments = []) {
  const next = normalizeReminderState(state);
  const livePrefixes = new Set(
    (Array.isArray(appointments) ? appointments : [])
      .filter(item => clean(item?.status || "confirmed").toLowerCase() === "confirmed")
      .map(item => `${clean(item?.id)}|${clean(item?.date)}|${clean(item?.time)}|`)
  );
  for (const key of Object.keys(next.sent)) {
    if (![...livePrefixes].some(prefix => key.startsWith(prefix))) delete next.sent[key];
  }
  return next;
}

export { DEFAULT_RULES };
