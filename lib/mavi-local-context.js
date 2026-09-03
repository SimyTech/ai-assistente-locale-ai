const text = (value, max = 120) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

const number = value => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const normalize = value => text(value, 1600)
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[’']/g, "'")
  .replace(/\s+/g, " ")
  .trim();

function serviceView(service) {
  const name = text(service?.name, 80);
  if (!name) return null;
  const price = number(service?.price);
  const duration = number(service?.duration);
  return {
    name,
    ...(price !== null ? { price } : {}),
    ...(duration !== null && duration > 0 ? { duration: Math.round(duration) } : {})
  };
}

function promotionView(promotion) {
  const title = text(promotion?.title || promotion?.name, 90);
  if (!title) return null;
  const price = number(promotion?.price);
  return {
    title,
    ...(price !== null ? { price } : {}),
    ...(promotion?.expires || promotion?.expiry || promotion?.deadline
      ? { expires: text(promotion.expires || promotion.expiry || promotion.deadline, 40) }
      : {})
  };
}

function hoursView(hours) {
  if (!hours || typeof hours !== "object" || Array.isArray(hours)) return {};
  const result = {};
  for (const [day, raw] of Object.entries(hours).slice(0, 7)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    result[text(day, 20)] = {
      closed: raw.closed === true || raw.open === false,
      ...(text(raw.open || raw.start || raw.from, 10) ? { open: text(raw.open || raw.start || raw.from, 10) } : {}),
      ...(text(raw.close || raw.end || raw.to, 10) ? { close: text(raw.close || raw.end || raw.to, 10) } : {})
    };
  }
  return result;
}

export function buildMaviLocalContext(context = {}, localData = {}) {
  const business = localData?.business && typeof localData.business === "object" ? localData.business : {};
  const settings = localData?.settings && typeof localData.settings === "object" ? localData.settings : {};
  const services = Array.isArray(localData?.services) ? localData.services : [];
  const promotions = Array.isArray(localData?.promotions) ? localData.promotions : [];
  const appointments = Array.isArray(localData?.appointments) ? localData.appointments : [];
  const clients = Array.isArray(localData?.clients) ? localData.clients : [];

  return {
    activity: {
      name: text(context.businessName || business.name, 100),
      type: text(context.businessType || business.type, 80),
      description: text(business.description, 240)
    },
    services: services.map(serviceView).filter(Boolean).slice(0, 10),
    promotions: promotions.map(promotionView).filter(Boolean).slice(0, 6),
    hours: hoursView(settings.hours || localData.hours),
    counts: {
      services: services.length,
      promotions: promotions.length,
      appointments: appointments.length,
      clients: clients.length
    }
  };
}

export function appendMaviConversation(history, user, assistant, maxMessages = 8) {
  const source = Array.isArray(history) ? history : [];
  const next = source.concat([
    { role: "user", content: text(user, 1200) },
    { role: "assistant", content: text(assistant, 1600) }
  ]).filter(message => message.content);
  return next.slice(-Math.max(2, maxMessages));
}

function detectDatePhrase(value) {
  const source = normalize(value);
  const match = source.match(/\b(oggi|domani|dopodomani|lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica|\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?)\b/);
  return match ? match[1] : "";
}

function detectTimePhrase(value) {
  const source = normalize(value);
  let match = source.match(/\b(?:alle|ore|verso le)?\s*(\d{1,2})[:.]([0-5]\d)\b/);
  if (match) return `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`;
  match = source.match(/\b(?:alle|ore|verso le)\s*(\d{1,2})\b/);
  if (match && Number(match[1]) <= 23) return `${String(Number(match[1])).padStart(2, "0")}:00`;
  return "";
}

function detectNamedItem(value, items = []) {
  const source = normalize(value);
  let best = "";
  for (const item of items) {
    const name = text(item?.name || item?.title, 100);
    const normalizedName = normalize(name);
    if (normalizedName && source.includes(normalizedName) && normalizedName.length > normalize(best).length) best = name;
  }
  return best;
}

export function resolveMaviOperationalContext(history = [], message = "", localData = {}) {
  const recent = (Array.isArray(history) ? history : [])
    .filter(item => item && item.role === "user" && text(item.content, 1200))
    .slice(-8)
    .map(item => text(item.content, 1200));

  const messages = recent.concat(text(message, 1200)).filter(Boolean);
  const services = Array.isArray(localData?.services) ? localData.services : [];
  const clients = Array.isArray(localData?.clients) ? localData.clients : [];

  const resolved = {
    date: "",
    time: "",
    service: "",
    client: ""
  };

  for (const value of messages) {
    const date = detectDatePhrase(value);
    const time = detectTimePhrase(value);
    const service = detectNamedItem(value, services);
    const client = detectNamedItem(value, clients);
    if (date) resolved.date = date;
    if (time) resolved.time = time;
    if (service) resolved.service = service;
    if (client) resolved.client = client;
  }

  const parts = [text(message, 1200)];
  if (resolved.date && !detectDatePhrase(message)) parts.push(resolved.date);
  if (resolved.time && !detectTimePhrase(message)) parts.push(`alle ${resolved.time}`);
  if (resolved.service && !detectNamedItem(message, services)) parts.push(resolved.service);
  if (resolved.client && !detectNamedItem(message, clients)) parts.push(resolved.client);

  return {
    ...resolved,
    enrichedMessage: parts.filter(Boolean).join(" ").trim()
  };
}

export function shouldUseResolvedOperationalContext(message = "", resolved = {}, localData = {}) {
  const source = normalize(message);
  if (!source || source.length > 120) return false;
  if (!resolved?.enrichedMessage || normalize(resolved.enrichedMessage) === source) return false;

  if (/^(e\b|invece\b|anzi\b|allora\b|quello\b|quella\b|stesso\b|stessa\b)/.test(source)) return true;
  if (/^(oggi|domani|dopodomani|lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica)\b/.test(source)) return true;
  if (/^(alle|ore|verso le)\s*\d{1,2}(?:[:.]\d{2})?\b/.test(source)) return true;
  if (/^\d{1,2}(?:[:.]\d{2})?$/.test(source)) return true;

  const services = Array.isArray(localData?.services) ? localData.services : [];
  const clients = Array.isArray(localData?.clients) ? localData.clients : [];
  if (detectNamedItem(message, services)) return true;
  if (detectNamedItem(message, clients)) return true;

  return false;
}
