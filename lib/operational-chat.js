import { buildOperationalCenter } from "./operational-center.js";

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
  if (clean(body.action) !== "chat") return false;
  const role = norm(body.role || body.mode || "owner");
  if (role === "client") return false;

  const message = norm(body.message);
  if (!message) return false;

  return /centro operativo|opportunita operative|priorita operative|buchi(?: nell| in)? agenda|riempi(?:re)? (?:i )?buchi|cosa posso recuperare|quanto posso recuperare|recuperare fatturato|recuperare valore|dove posso recuperare|cosa posso fare.*agenda|azioni.*recuper/.test(message);
}

function formatAction(item) {
  if (item.type === "cancellation-recovery") {
    const value = Number(item.value || 0);
    return `• Recupera ${item.name || "una cancellazione"}${item.service ? ` — ${item.service}` : ""}${value > 0 ? `, valore €${value.toFixed(2)}` : ""}`;
  }
  if (item.type === "inactive-client") {
    return `• Ricontatta ${item.name || "cliente inattivo"}${item.lastVisit ? ` — ultima visita ${item.lastVisit}` : ""}${item.service ? `, ${item.service}` : ""}`;
  }
  if (item.type === "agenda-gap") {
    return `• Riempi ${item.date} ${item.start}–${item.end} — ${item.minutes} min liberi`;
  }
  return `• ${clean(item.label) || "Azione operativa"}`;
}

export function buildOperationalChatResponse(body = {}, options = {}) {
  if (!isOperationalCenterQuestion(body)) return null;

  const center = buildOperationalCenter({
    ...body,
    hours: normalizedHours(body)
  }, options);

  const summary = center.summary;
  const topActions = center.actions.slice(0, 6);
  const lines = [
    "Centro Operativo Mavi:",
    `• Azioni utili rilevate: ${summary.totalActions}`,
    `• Buchi agenda: ${summary.agendaGaps}`,
    `• Clienti inattivi: ${summary.inactiveClients}`,
    `• Cancellazioni recuperabili: ${summary.cancellationRecoveries}`,
    `• Valore recuperabile stimato: €${Number(summary.recoverableValue || 0).toFixed(2)}`
  ];

  if (!topActions.length) {
    lines.push("Non vedo azioni urgenti da proporre in questo momento.");
  } else {
    lines.push("Priorità:", ...topActions.map(formatAction));
  }

  return { answer: lines.join("\n"), center };
}
