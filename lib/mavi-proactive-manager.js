import { buildOperationalCenter } from "./operational-center.js";
import { findWeakTimeBands } from "./mavi-demand-insights.js";

const DAY_MS = 86400000;
const PRIORITY = { high: 0, medium: 1, low: 2 };

function clean(value) {
  return String(value ?? "").trim();
}

function dateOnly(value) {
  const text = clean(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${to}T12:00:00Z`);
  return Math.round((b - a) / DAY_MS);
}

function promotionExpiry(promotion) {
  return dateOnly(promotion?.expiresAt || promotion?.expiry || promotion?.validUntil || promotion?.endDate || promotion?.valid);
}

export function findExpiringPromotions(body = {}, options = {}) {
  const today = dateOnly(options.now || new Date());
  const horizonDays = Math.max(1, Number(options.promotionHorizonDays) || 7);
  return (Array.isArray(body.promotions) ? body.promotions : [])
    .filter(item => item && item.active !== false && item.enabled !== false)
    .flatMap(item => {
      const expiry = promotionExpiry(item);
      if (!expiry) return [];
      const daysLeft = daysBetween(today, expiry);
      if (daysLeft < 0 || daysLeft > horizonDays) return [];
      const name = clean(item.title || item.name || item.description) || "Promozione";
      return [{
        type: "promotion-expiry",
        priority: daysLeft <= 2 ? "high" : "medium",
        action: "review-promotion",
        label: daysLeft === 0 ? `${name} scade oggi` : `${name} scade tra ${daysLeft} ${daysLeft === 1 ? "giorno" : "giorni"}`,
        name,
        expiry,
        daysLeft
      }];
    })
    .sort((a, b) => a.daysLeft - b.daysLeft || a.name.localeCompare(b.name));
}

function messageForAction(item) {
  if (item.type === "agenda-gap") {
    const value = Number(item.potentialValue || 0);
    return `Hai un buco ${item.date} dalle ${item.start} alle ${item.end}${item.recommendedService?.name ? `: può entrare ${item.recommendedService.name}` : ""}${value > 0 ? ` (valore potenziale €${value.toFixed(2)})` : ""}.`;
  }
  if (item.type === "inactive-client") return `${item.name || "Un cliente"} non torna da ${item.inactiveDays} giorni.`;
  if (item.type === "cancellation-recovery") return `${item.name || "Un cliente"} ha una cancellazione non recuperata${item.value > 0 ? ` da circa €${Number(item.value).toFixed(2)}` : ""}.`;
  if (item.type === "promotion-expiry") return `${item.label}.`;
  if (item.type === "weak-time-band") {
    const pct = Math.round(Number(item.share || 0) * 100);
    return `La fascia ${item.label} è debole: ${item.appointments} prestazioni completate negli ultimi ${item.lookbackDays} giorni${Number.isFinite(pct) ? ` (${pct}% del totale nelle fasce analizzate)` : ""}. Può essere utile concentrare qui una promozione o un richiamo mirato.`;
  }
  return clean(item.label);
}

export function buildProactiveBrief(body = {}, options = {}) {
  const center = buildOperationalCenter(body, options);
  const promotions = findExpiringPromotions(body, options);
  const weakBands = findWeakTimeBands(body, options);
  const items = [...center.actions, ...promotions, ...weakBands]
    .map(item => ({ ...item, message: messageForAction(item), requiresApproval: true, autoExecute: false }))
    .filter(item => item.message)
    .sort((a, b) => (PRIORITY[a.priority] ?? 9) - (PRIORITY[b.priority] ?? 9) || Number(b.value || b.potentialValue || 0) - Number(a.value || a.potentialValue || 0));

  const maxItems = Math.max(1, Number(options.maxItems) || 3);
  const visible = items.slice(0, maxItems);
  return {
    generatedAt: new Date(options.now || Date.now()).toISOString(),
    hasAttention: visible.length > 0,
    totalItems: items.length,
    weakTimeBands: weakBands.length,
    items: visible,
    text: visible.length
      ? `Mavi ha ${items.length} ${items.length === 1 ? "segnalazione" : "segnalazioni"} per te:\n${visible.map(item => `• ${item.message}`).join("\n")}`
      : "Non vedo criticità o opportunità urgenti in questo momento."
  };
}
