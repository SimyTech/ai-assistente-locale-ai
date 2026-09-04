const DAY_MS = 86400000;

const BANDS = Object.freeze([
  { id: "morning", label: "mattina", start: 8 * 60, end: 12 * 60 },
  { id: "midday", label: "pranzo", start: 12 * 60, end: 15 * 60 },
  { id: "afternoon", label: "pomeriggio", start: 15 * 60, end: 18 * 60 },
  { id: "evening", label: "sera", start: 18 * 60, end: 22 * 60 }
]);

function clean(value) { return String(value ?? "").trim(); }
function norm(value) { return clean(value).toLowerCase(); }
function dateOnly(value) { const text = clean(value); if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text; const parsed = new Date(text); return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10); }
function addDays(date, days) { const next = new Date(`${date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + days); return next.toISOString().slice(0, 10); }
function minutes(value) { const match = clean(value).match(/^(\d{1,2}):(\d{2})$/); if (!match) return null; const hours = Number(match[1]); const mins = Number(match[2]); return hours > 23 || mins > 59 ? null : hours * 60 + mins; }
function appointmentTime(item) { const direct = clean(item?.time || item?.startTime); if (/^\d{1,2}:\d{2}$/.test(direct)) return direct.padStart(5, "0"); return clean(item?.start || item?.startsAt).match(/T(\d{2}:\d{2})/)?.[1] || ""; }
function completed(item) { return ["completed", "completato", "completata", "done"].includes(norm(item?.status)); }
function servicePrice(item, services) { const direct = Number(item?.price ?? item?.amount); if (Number.isFinite(direct) && direct >= 0) return direct; const wanted = norm(item?.service || item?.serviceName); const service = services.find(candidate => norm(candidate?.name) === wanted); const price = Number(service?.price ?? service?.amount); return Number.isFinite(price) && price >= 0 ? price : 0; }

function subtractBreaks(start, end, breaks = []) {
  let ranges = [[start, end]];
  for (const pause of breaks) {
    const pauseStart = minutes(pause?.start || pause?.from || pause?.[0]);
    const pauseEnd = minutes(pause?.end || pause?.to || pause?.[1]);
    if (pauseStart === null || pauseEnd === null || pauseEnd <= pauseStart) continue;
    ranges = ranges.flatMap(([rangeStart, rangeEnd]) => {
      if (pauseEnd <= rangeStart || pauseStart >= rangeEnd) return [[rangeStart, rangeEnd]];
      const result = [];
      if (pauseStart > rangeStart) result.push([rangeStart, Math.min(pauseStart, rangeEnd)]);
      if (pauseEnd < rangeEnd) result.push([Math.max(pauseEnd, rangeStart), rangeEnd]);
      return result;
    });
  }
  return ranges.filter(([rangeStart, rangeEnd]) => rangeEnd > rangeStart);
}

function openRanges(hours = {}) {
  return Object.values(hours || {}).flatMap(source => {
    if (!source || source === false || source?.closed === true || source?.open === false) return [];
    const start = minutes(source?.start || source?.open || source?.from || source?.[0]);
    const end = minutes(source?.end || source?.close || source?.to || source?.[1]);
    if (start === null || end === null || end <= start) return [];
    const breaks = Array.isArray(source?.breaks) ? source.breaks : [];
    return subtractBreaks(start, end, breaks);
  });
}

function activeBands(body = {}) {
  const ranges = openRanges(body.hours || body.business?.hours || {});
  if (!ranges.length) return [];
  return BANDS.filter(band => {
    const bandMinutes = band.end - band.start;
    const availableMinutes = ranges.reduce((sum, [start, end]) => sum + Math.max(0, Math.min(end, band.end) - Math.max(start, band.start)), 0);
    return availableMinutes >= bandMinutes * 0.5;
  });
}

export function findWeakTimeBands(body = {}, options = {}) {
  const today = dateOnly(options.now || new Date());
  const lookbackDays = Math.max(14, Number(options.lookbackDays) || 90);
  const lowerBound = addDays(today, -lookbackDays + 1);
  const minCompleted = Math.max(4, Number(options.minCompleted) || 8);
  const weaknessRatio = Math.max(0.1, Math.min(0.9, Number(options.weaknessRatio) || 0.6));
  const services = Array.isArray(body.services) ? body.services.filter(Boolean) : [];
  const bands = activeBands(body);
  const stats = new Map(bands.map(band => [band.id, { ...band, appointments: 0, value: 0 }]));

  for (const item of Array.isArray(body.appointments) ? body.appointments : []) {
    if (!completed(item)) continue;
    const date = dateOnly(item?.date || item?.day || item?.start || item?.startsAt);
    if (!date || date < lowerBound || date > today) continue;
    const time = minutes(appointmentTime(item));
    if (time === null) continue;
    const band = bands.find(candidate => time >= candidate.start && time < candidate.end);
    if (!band) continue;
    const row = stats.get(band.id);
    row.appointments += 1;
    row.value += servicePrice(item, services);
  }

  const rows = [...stats.values()];
  const totalCompleted = rows.reduce((sum, row) => sum + row.appointments, 0);
  if (totalCompleted < minCompleted || rows.length < 2) return [];
  const average = totalCompleted / rows.length;
  return rows.filter(row => row.appointments <= average * weaknessRatio).map(row => ({ type: "weak-time-band", priority: row.appointments === 0 ? "high" : "medium", action: "improve-demand", band: row.id, label: row.label, appointments: row.appointments, value: row.value, averageAppointments: average, lookbackDays, share: totalCompleted ? row.appointments / totalCompleted : 0, requiresApproval: true, autoExecute: false })).sort((a, b) => a.appointments - b.appointments || a.value - b.value);
}

export function buildDemandInsight(body = {}, options = {}) {
  const weakBands = findWeakTimeBands(body, options);
  const weakest = weakBands[0] || null;
  return { generatedAt: new Date(options.now || Date.now()).toISOString(), weakBands, weakest, text: weakest ? `La fascia più debole è ${weakest.label}: ${weakest.appointments} prestazioni completate negli ultimi ${weakest.lookbackDays} giorni. Può essere utile concentrare qui una promozione o un richiamo mirato, sempre dopo conferma del titolare.` : "Non ci sono ancora dati sufficienti per individuare una fascia oraria debole in modo affidabile." };
}
