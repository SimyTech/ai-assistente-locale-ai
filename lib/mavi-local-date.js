const normalize = value => String(value || "").toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s/]/g, " ").replace(/\s+/g, " ").trim();

const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const WEEKDAYS = ["domenica", "lunedi", "martedi", "mercoledi", "giovedi", "venerdi", "sabato"];
const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const dateAt = (year, month, day) => new Date(year, month, day, 12, 0, 0, 0);
const addDays = (date, amount) => dateAt(date.getFullYear(), date.getMonth(), date.getDate() + amount);
const dayRange = (date, label) => ({ start: iso(date), end: iso(date), label, kind: "day" });
const monthRange = (year, month, label) => ({ start: iso(dateAt(year, month, 1)), end: iso(dateAt(year, month + 1, 0)), label, kind: "month" });
const yearRange = (year, label) => ({ start: iso(dateAt(year, 0, 1)), end: iso(dateAt(year, 11, 31)), label, kind: "year" });

function weekdayRange(text, now) {
  const index = WEEKDAYS.findIndex(name => new RegExp(`\\b${name}\\b`).test(text));
  if (index < 0) return null;
  const past = /scors|passat|precedent/.test(text);
  let delta = (index - now.getDay() + 7) % 7;
  if (past) delta = -((now.getDay() - index + 7) % 7 || 7);
  else if (/prossim/.test(text) && delta === 0) delta = 7;
  const target = addDays(now, delta);
  return dayRange(target, `${WEEKDAYS[index]} ${target.getDate()}/${target.getMonth() + 1}`);
}

function relativeNumericPeriod(text, now) {
  const daysAgo = text.match(/\b(\d{1,3})\s+giorn[io]\s+fa\b/);
  if (daysAgo) {
    const count = Math.min(366, Math.max(1, Number(daysAgo[1])));
    return dayRange(addDays(now, -count), `${count} ${count === 1 ? "giorno" : "giorni"} fa`);
  }

  const daysAhead = text.match(/\b(?:tra|fra)\s+(\d{1,3})\s+giorn[io]\b/);
  if (daysAhead) {
    const count = Math.min(366, Math.max(1, Number(daysAhead[1])));
    return dayRange(addDays(now, count), `tra ${count} ${count === 1 ? "giorno" : "giorni"}`);
  }

  const monthsAgo = text.match(/\b(\d{1,2})\s+mes[ei]\s+fa\b/);
  if (monthsAgo) {
    const count = Math.min(24, Math.max(1, Number(monthsAgo[1])));
    return monthRange(now.getFullYear(), now.getMonth() - count, `${count} ${count === 1 ? "mese" : "mesi"} fa`);
  }

  const monthsAhead = text.match(/\b(?:tra|fra)\s+(\d{1,2})\s+mes[ei]\b/);
  if (monthsAhead) {
    const count = Math.min(24, Math.max(1, Number(monthsAhead[1])));
    return monthRange(now.getFullYear(), now.getMonth() + count, `tra ${count} ${count === 1 ? "mese" : "mesi"}`);
  }

  const lastMonths = text.match(/\bultim[ioe]?\s+(\d{1,2})\s+mes[ei]\b/);
  if (lastMonths) {
    const count = Math.min(24, Math.max(1, Number(lastMonths[1])));
    const start = dateAt(now.getFullYear(), now.getMonth() - count + 1, 1);
    return {
      start: iso(start),
      end: iso(now),
      label: `ultimi ${count} mesi`,
      kind: "range"
    };
  }

  return null;
}

export function parseLocalAgendaPeriod(message, current = new Date()) {
  const text = normalize(message);
  const now = dateAt(current.getFullYear(), current.getMonth(), current.getDate());
  if (/\b(l altro ieri|altro ieri)\b/.test(text)) return dayRange(addDays(now, -2), "l'altro ieri");
  if (/\bieri\b/.test(text)) return dayRange(addDays(now, -1), "ieri");
  if (/\bdopodomani\b/.test(text)) return dayRange(addDays(now, 2), "dopodomani");
  if (/\bdomani\b/.test(text)) return dayRange(addDays(now, 1), "domani");
  if (/\boggi\b/.test(text)) return dayRange(now, "oggi");

  const numericRelative = relativeNumericPeriod(text, now);
  if (numericRelative) return numericRelative;

  const relativeDays = text.match(/ultim[ioe]?\s+(\d{1,3})\s+giorn/);
  if (relativeDays) {
    const count = Math.min(366, Math.max(1, Number(relativeDays[1])));
    return { start: iso(addDays(now, -(count - 1))), end: iso(now), label: `ultimi ${count} giorni`, kind: "range" };
  }

  if (/(mese (?:prossimo|successivo)|prossimo mese)/.test(text)) return monthRange(now.getFullYear(), now.getMonth() + 1, "il mese prossimo");
  if (/(mese (?:scorso|passato|precedente)|scorso mese)/.test(text)) return monthRange(now.getFullYear(), now.getMonth() - 1, "il mese scorso");
  if (/(questo mese|mese (?:corrente|attuale)|nel mese|in questo mese)/.test(text)) return monthRange(now.getFullYear(), now.getMonth(), "questo mese");
  if (/(quest anno|anno (?:corrente|attuale)|in questo anno)/.test(text)) return yearRange(now.getFullYear(), "quest'anno");
  if (/(anno (?:prossimo|successivo)|prossimo anno)/.test(text)) return yearRange(now.getFullYear() + 1, "l'anno prossimo");
  if (/(anno (?:scorso|passato|precedente)|scorso anno)/.test(text)) return yearRange(now.getFullYear() - 1, "l'anno scorso");
  if (/(questa settimana|settimana (?:corrente|attuale)|nella settimana)/.test(text)) {
    const mondayOffset = (now.getDay() + 6) % 7;
    const start = addDays(now, -mondayOffset);
    return { start: iso(start), end: iso(addDays(start, 6)), label: "questa settimana", kind: "week" };
  }
  if (/(settimana (?:scorsa|passata|precedente))/.test(text)) {
    const mondayOffset = (now.getDay() + 6) % 7;
    const end = addDays(now, -mondayOffset - 1);
    return { start: iso(addDays(end, -6)), end: iso(end), label: "la settimana scorsa", kind: "week" };
  }
  if (/(settimana (?:prossima|successiva))/.test(text)) {
    const mondayOffset = (now.getDay() + 6) % 7;
    const start = addDays(now, 7 - mondayOffset);
    return { start: iso(start), end: iso(addDays(start, 6)), label: "la settimana prossima", kind: "week" };
  }

  const numeric = text.match(/\b(\d{1,2})[\s/.-]+(\d{1,2})(?:[\s/.-]+(\d{2,4}))?\b/);
  if (numeric) {
    const year = numeric[3] ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]) : now.getFullYear();
    const target = dateAt(year, Number(numeric[2]) - 1, Number(numeric[1]));
    if (target.getFullYear() === year && target.getMonth() === Number(numeric[2]) - 1 && target.getDate() === Number(numeric[1])) return dayRange(target, `${numeric[1]}/${numeric[2]}/${year}`);
  }

  const bareDay = MONTHS.some(name => new RegExp(`\\b${name}\\b`).test(text)) ? null : text.match(/\b(?:il|giorno|del)\s+(\d{1,2})\b/);

  for (let month = 0; month < MONTHS.length; month += 1) {
    const name = MONTHS[month];
    if (!new RegExp(`\\b${name}\\b`).test(text)) continue;
    const day = text.match(new RegExp(`\\b(\\d{1,2})\\s+(?:di\\s+)?${name}\\b`));
    let year = Number(text.match(new RegExp(`${name}\\s+(20\\d{2})`))?.[1] || now.getFullYear());
    if (!day && !/scors|passat|precedent/.test(text) && month < now.getMonth()) year += 1;
    if (day) {
      const target = dateAt(year, month, Number(day[1]));
      if (target.getMonth() === month && target.getDate() === Number(day[1])) return dayRange(target, `${day[1]} ${name} ${year}`);
    }
    return monthRange(year, month, `${name} ${year}`);
  }
  if (bareDay) {
    const day = Number(bareDay[1]);
    let target = dateAt(now.getFullYear(), now.getMonth(), day);
    if (target < now) target = dateAt(now.getFullYear(), now.getMonth() + 1, day);
    if (target.getDate() === day) return dayRange(target, `${day}/${target.getMonth() + 1}/${target.getFullYear()}`);
  }
  return weekdayRange(text, now);
}
