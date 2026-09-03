const normalize = value => String(value || "")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9\s]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const isoLocal = date => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const activeAppointment = appointment => !["cancelled", "no_show"].includes(appointment?.status || "confirmed");
const has = (text, pattern) => pattern.test(text);
const readIntent = text => !has(text, /(prenot|fissa|sposta|rimanda|annulla|cancella|modifica|crea|aggiung|elimina|invia|manda)/);

function asksForDaySchedule(text) {
  const day = has(text, /\b(oggi|domani)\b/);
  const schedule = has(text, /(programm|agenda|appuntament|impegn|giornata|chi (?:vedo|viene|ho)|come sono messo)/);
  const duties = has(text, /(?:cosa|che).*(?:ho|devo).*(?:fare|gestire)|(?:cosa|che) faccio/);
  const colloquial = has(text, /(?:cosa|che) (?:si fa|facciamo|c e da fare|mi aspetta|ci aspetta|abbiamo)|(?:cos|cosa|che) (?:ho|c e) (?:oggi|domani)|(?:oggi|domani).*(?:che si fa|cosa si fa|che facciamo|cosa facciamo|che c e|cosa c e|che mi aspetta|che abbiamo|come va|situazione)|^(?:oggi|domani)$/);
  return day && readIntent(text) && (schedule || duties || colloquial);
}

function todayPlanAnswer(message, data, now) {
  const text = normalize(message);
  const asksTodayPlan = has(text, /\boggi\b/) && asksForDaySchedule(text);
  if (!asksTodayPlan) return null;

  const today = isoLocal(now);
  const tomorrowDate = new Date(now);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = isoLocal(tomorrowDate);
  const currentMoment = now.getTime();
  const appointments = Array.isArray(data.appointments) ? data.appointments : [];
  const todayItems = appointments
    .filter(item => (item.status || "confirmed") === "confirmed" && item.date === today)
    .sort((a, b) => String(a.time || "").localeCompare(String(b.time || "")));
  const reminders = appointments.filter(item =>
    (item.status || "confirmed") === "confirmed" && item.date === tomorrow && !item.reminderSentAt
  );
  const overdue = appointments.filter(item => {
    if ((item.status || "confirmed") !== "confirmed" || !item.date || !item.time) return false;
    const moment = new Date(`${item.date}T${item.time}:00`).getTime();
    return Number.isFinite(moment) && moment < currentMoment;
  });

  const lines = ["Programma di oggi:"];
  if (todayItems.length) {
    lines.push(...todayItems.map(item => `${item.time || "--:--"} — ${item.name || "Cliente"}${item.service ? ` — ${item.service}` : ""}`));
  } else {
    lines.push("Nessun appuntamento confermato.");
  }
  lines.push("", "Azioni da gestire:");
  if (!reminders.length && !overdue.length) lines.push("Nessuna azione urgente.");
  if (reminders.length) lines.push(`• Promemoria da inviare per domani: ${reminders.length}`);
  if (overdue.length) lines.push(`• Appuntamenti passati da chiudere: ${overdue.length}`);
  return lines.join("\n");
}

function appointmentAnswer(message, data, now) {
  const text = normalize(message);
  if (!asksForDaySchedule(text)) return null;
  const offset = /domani/.test(text) ? 1 : /oggi/.test(text) ? 0 : null;
  if (offset === null) return null;
  const wanted = new Date(now);
  wanted.setDate(wanted.getDate() + offset);
  const items = (data.appointments || [])
    .filter(item => activeAppointment(item) && item.date === isoLocal(wanted))
    .sort((a, b) => String(a.time || "").localeCompare(String(b.time || "")));
  const day = offset ? "domani" : "oggi";
  if (!items.length) return `Non hai appuntamenti confermati per ${day}.`;
  return `Per ${day} hai ${items.length} ${items.length === 1 ? "appuntamento" : "appuntamenti"}:\n${items.map(item => `${item.time || "--:--"} — ${item.name || "Cliente"}${item.service ? ` — ${item.service}` : ""}`).join("\n")}`;
}

function servicesAnswer(message, data) {
  const text = normalize(message);
  if (!readIntent(text) || !/(serviz|trattament|prezz|cost|tariff|listino|cosa (?:offro|propongo)|quanto (?:faccio pagare|costa))/.test(text)) return null;
  const services = Array.isArray(data.services) ? data.services : [];
  if (!services.length) return "Non risultano servizi configurati.";
  return `Servizi configurati:\n${services.map(service => `${service.name || "Servizio"}${Number.isFinite(Number(service.price)) ? ` — €${Number(service.price).toFixed(2)}` : ""}${service.duration ? ` — ${service.duration} min` : ""}`).join("\n")}`;
}

function clientsAnswer(message, data) {
  const text = normalize(message);
  if (!readIntent(text) || !/(quanti (?:client|contatt|person)|numero (?:client|contatt)|elenco (?:client|contatt)|lista (?:client|contatt)|rubrica)/.test(text)) return null;
  const clients = Array.isArray(data.clients) ? data.clients : [];
  if (/elenco|lista/.test(text) && clients.length) return `Hai ${clients.length} clienti:\n${clients.map(client => client.name || "Cliente").join("\n")}`;
  return `Hai ${clients.length} ${clients.length === 1 ? "cliente" : "clienti"} in archivio.`;
}

function promotionsAnswer(message, data) {
  const text = normalize(message);
  if (!readIntent(text) || !/(promozion|promo|offert|scont|iniziativ.*attiv)/.test(text)) return null;
  const promotions = Array.isArray(data.promotions) ? data.promotions : [];
  if (!promotions.length) return "Non risultano promozioni attive configurate.";
  return `Promozioni configurate:\n${promotions.map(item => `${item.title || "Promozione"}${item.valid ? ` — ${item.valid}` : ""}`).join("\n")}`;
}

function hoursAnswer(message, data) {
  const text = normalize(message);
  if (!readIntent(text) || !/(orar|quando (?:apro|apriamo|chiudo|chiudiamo)|giorni? (?:apert|chius)|a che ora)/.test(text)) return null;
  const hours = Array.isArray(data.settings?.hours) ? data.settings.hours : [];
  if (!hours.length) return "Non risultano orari configurati.";
  return `Orari configurati:\n${hours.map((item, index) => {
    const name = item.name || ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"][index] || "Giorno";
    if (item.closed) return `${name} — Chiuso`;
    return `${name} — ${item.open || "--:--"}–${item.close || "--:--"}`;
  }).join("\n")}`;
}

function businessAnswer(message, data) {
  const text = normalize(message);
  const business = data.business || {};
  if (!readIntent(text)) return null;
  if (/(dove (?:siamo|siete)|qual e l indirizzo|indirizzo dell attivita)/.test(text)) {
    return business.address ? `L'indirizzo configurato è: ${business.address}.` : "Non risulta un indirizzo configurato.";
  }
  if (/(numero di telefono|telefono dell attivita|contatto dell attivita|numero whatsapp)/.test(text)) {
    const contact = business.whatsapp || business.phone;
    return contact ? `Il contatto configurato è: ${contact}.` : "Non risulta un contatto configurato.";
  }
  return null;
}

export function answerFastLocalData(message, data = {}, now = new Date()) {
  const answer = todayPlanAnswer(message, data, now)
    || appointmentAnswer(message, data, now)
    || hoursAnswer(message, data)
    || businessAnswer(message, data)
    || clientsAnswer(message, data)
    || servicesAnswer(message, data)
    || promotionsAnswer(message, data);
  return answer ? { handled: true, answer } : { handled: false, answer: "" };
}
