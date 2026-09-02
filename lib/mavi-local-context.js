const text = (value, max = 120) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

const number = value => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

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
