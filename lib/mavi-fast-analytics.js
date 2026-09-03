import { parseLocalAgendaPeriod } from "./mavi-local-date.js";

const normalize = value => String(value || "").toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const euro = value => `€${Number(value || 0).toFixed(2)}`;
const iso = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;

function servicePrice(appointment, data) {
  const direct = Number(appointment?.price);
  if (Number.isFinite(direct) && direct >= 0) return direct;
  const wanted = normalize(appointment?.service);
  const service = (data.services || []).find(item => normalize(item?.name) === wanted);
  const price = Number(service?.price);
  return Number.isFinite(price) && price >= 0 ? price : 0;
}

function completedValue(data, period) {
  const appointments = Array.isArray(data.appointments) ? data.appointments : [];
  return appointments
    .filter(item => item?.status === "completed" && item?.date >= period.start && item?.date <= period.end)
    .reduce((sum, item) => sum + servicePrice(item, data), 0);
}

function previousComparablePeriod(period) {
  const start = new Date(`${period.start}T12:00:00`);
  const end = new Date(`${period.end}T12:00:00`);
  if (period.kind === "month") {
    const previousStart = new Date(start.getFullYear(), start.getMonth() - 1, 1, 12);
    const previousEnd = new Date(start.getFullYear(), start.getMonth(), 0, 12);
    return { start: iso(previousStart), end: iso(previousEnd), label: "mese precedente" };
  }
  if (period.kind === "year") {
    const year = start.getFullYear() - 1;
    return { start: `${year}-01-01`, end: `${year}-12-31`, label: "anno precedente" };
  }
  if (period.kind === "week") {
    const previousStart = new Date(start); previousStart.setDate(previousStart.getDate() - 7);
    const previousEnd = new Date(end); previousEnd.setDate(previousEnd.getDate() - 7);
    return { start: iso(previousStart), end: iso(previousEnd), label: "settimana precedente" };
  }
  const length = Math.max(1, Math.round((end - start) / 86400000) + 1);
  const previousEnd = new Date(start); previousEnd.setDate(previousEnd.getDate() - 1);
  const previousStart = new Date(previousEnd); previousStart.setDate(previousStart.getDate() - length + 1);
  return { start: iso(previousStart), end: iso(previousEnd), label: "periodo precedente" };
}

function primaryPeriod(text, now) {
  if (/\b(questo mese|mese corrente|mese attuale|in questo mese)\b/.test(text)) return parseLocalAgendaPeriod("questo mese", now);
  if (/\b(questa settimana|settimana corrente|settimana attuale)\b/.test(text)) return parseLocalAgendaPeriod("questa settimana", now);
  if (/\b(quest anno|anno corrente|anno attuale|in questo anno)\b/.test(text)) return parseLocalAgendaPeriod("quest anno", now);
  const beforeComparison = text.split(/\b(?:rispetto|confronta?|paragona?)\b/)[0].trim();
  return parseLocalAgendaPeriod(beforeComparison || text, now) || parseLocalAgendaPeriod(text, now);
}

export function answerFastAnalytics(message, data = {}, now = new Date()) {
  const text = normalize(message);
  if (!/(incass|fatturat|ricav|entrate|valore (?:generato|completato))/.test(text)) return null;
  const period = primaryPeriod(text, now);
  if (!period) return null;

  const current = completedValue(data, period);
  const wantsComparison = /(rispetto|confront|paragon|differenza|mese scorso|settimana scorsa|anno scorso|periodo precedente)/.test(text);
  if (!wantsComparison) {
    return `Valore stimato delle prestazioni completate per ${period.label}: ${euro(current)}. È una stima gestionale basata sugli appuntamenti completati e sui prezzi configurati; non sostituisce la contabilità fiscale.`;
  }

  const previous = previousComparablePeriod(period);
  const before = completedValue(data, previous);
  const delta = current - before;
  const pct = before > 0 ? (delta / before) * 100 : null;
  const direction = delta > 0 ? "in aumento" : delta < 0 ? "in calo" : "invariato";
  const variation = pct === null ? `${euro(Math.abs(delta))} di differenza` : `${delta >= 0 ? "+" : ""}${pct.toFixed(1)}% (${delta >= 0 ? "+" : "-"}${euro(Math.abs(delta))})`;
  return `Valore stimato delle prestazioni completate per ${period.label}: ${euro(current)}. ${previous.label.charAt(0).toUpperCase()+previous.label.slice(1)}: ${euro(before)}. Andamento ${direction}: ${variation}. È una stima gestionale basata sugli appuntamenti completati e sui prezzi configurati; non sostituisce la contabilità fiscale.`;
}
