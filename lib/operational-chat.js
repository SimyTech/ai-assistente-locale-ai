import { buildOperationalCenter } from "./operational-center.js";
import { isExplicitOwnerChat } from "./assistant-role.js";

const clean = value => String(value ?? "").trim();
const norm = value => clean(value)
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/\s+/g, " ");

function normalizedHours(body = {}) {
  const direct = body.hours || body.business?.hours;
  if (direct && !Array.isArray(direct)) return direct;

  const source = body.settings?.hours;
  if (!Array.isArray(source)) return source && typeof source === "object" ? source : {};

  const keys = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  return Object.fromEntries(keys.map((key, index) => [key, source[index] || { closed: true }]));
}

export function isOperationalCenterQuestion(body = {}) {
  if (!isExplicitOwnerChat(body)) return false;

  const message = norm(body.message);
  if (!message) return false;

  return /centro operativo|opportunita operative|priorita operative|buchi(?: nell| in)? agenda|riempi(?:re)? (?:i )?buchi|cosa posso recuperare|quanto posso recuperare|recuperare fatturato|recuperare valore|dove posso recuperare|cosa posso fare.*agenda|azioni.*recuper/.test(message);
}

function gapFitsService(gap, serviceName) {
  const wanted = norm(serviceName);
  if (!wanted) return false;
  return Array.isArray(gap.compatibleServices) && gap.compatibleServices.some(service => norm(service?.name) === wanted);
}

function matchRecoveryActions(center) {
  const actions = Array.isArray(center?.actions) ? center.actions : [];
  const gaps = actions.filter(item => item.type === "agenda-gap");
  if (!gaps.length) return center;

  const matched = actions.map(item => {
    if (!["inactive-client", "cancellation-recovery"].includes(item.type) || !clean(item.service)) return item;
    const gap = gaps.find(candidate => gapFitsService(candidate, item.service));
    if (!gap) return item;
    const suggestedGap = {
      date: gap.date,
      start: gap.start,
      end: gap.end,
      minutes: gap.minutes,
      service: item.service,
      potentialValue: Number(item.value || gap.potentialValue || 0)
    };
    return {
      ...item,
      suggestedGap,
      label: `${item.label || (item.name ? `Ricontatta ${item.name}` : "Recupera cliente")} · proponi ${gap.date} alle ${gap.start}`
    };
  });

  return { ...center, actions: matched };
}

function formatSuggestedGap(item) {
  const gap = item.suggestedGap;
  if (!gap) return "";
  return `; proponi ${gap.date} alle ${gap.start}${gap.service ? ` per ${gap.service}` : ""}`;
}

function formatAction(item) {
  if (item.type === "cancellation-recovery") {
    const value = Number(item.value || 0);
    return `• Recupera ${item.name || "una cancellazione"}${item.service ? ` — ${item.service}` : ""}${value > 0 ? `, valore €${value.toFixed(2)}` : ""}${formatSuggestedGap(item)}`;
  }
  if (item.type === "inactive-client") {
    return `• Ricontatta ${item.name || "cliente inattivo"}${item.lastVisit ? ` — ultima visita ${item.lastVisit}` : ""}${item.service ? `, ${item.service}` : ""}${formatSuggestedGap(item)}`;
  }
  if (item.type === "agenda-gap") {
    const service = item.recommendedService;
    const opportunity = Number(item.potentialValue || 0);
    return `• Riempi ${item.date} ${item.start}–${item.end} — ${item.minutes} min liberi${service ? `; prova ${service.name} (${service.duration} min${opportunity > 0 ? `, circa €${opportunity.toFixed(2)}` : ""})` : ""}`;
  }
  return `• ${clean(item.label) || "Azione operativa"}`;
}

export function buildOperationalChatResponse(body = {}, options = {}) {
  if (!isOperationalCenterQuestion(body)) return null;

  let center = buildOperationalCenter({
    ...body,
    hours: normalizedHours(body)
  }, options);
  center = matchRecoveryActions(center);

  const baseSummary = center.summary;
  const cancellationRecoverableValue = Number(baseSummary.recoverableValue || 0);
  const totalValueOpportunity = Number(baseSummary.totalValueOpportunity || cancellationRecoverableValue);
  center.summary = {
    ...baseSummary,
    cancellationRecoverableValue,
    recoverableValue: totalValueOpportunity
  };

  const summary = center.summary;
  const topActions = center.actions.slice(0, 6);
  const lines = [
    "Centro Operativo Mavi:",
    `• Azioni utili rilevate: ${summary.totalActions}`,
    `• Buchi agenda: ${summary.agendaGaps}`,
    `• Clienti inattivi: ${summary.inactiveClients}`,
    `• Cancellazioni recuperabili: ${summary.cancellationRecoveries}`,
    `• Valore cancellazioni recuperabili: €${Number(summary.cancellationRecoverableValue || 0).toFixed(2)}`,
    `• Valore potenziale dei buchi agenda: €${Number(summary.agendaPotentialValue || 0).toFixed(2)}`,
    `• Opportunità economica complessiva: €${Number(summary.recoverableValue || 0).toFixed(2)}`
  ];

  if (!topActions.length) {
    lines.push("Non vedo azioni urgenti da proporre in questo momento.");
  } else {
    lines.push("Priorità:", ...topActions.map(formatAction));
  }

  return { answer: lines.join("\n"), center };
}
