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

function todayPlanAnswer(message, data, now) {
  const text = normalize(message);
  const asksTodayPlan = /(?:cosa|che).*(?:ho|devo).*(?:fare|gestire).*oggi|(?:cosa|che).*(?:ho|devo).*oggi.*(?:fare|gestire)|dimmi.*oggi.*(?:fare|gestire)/.test(text);
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
  if (!/(appuntament|impegn|programma|chi viene|chi ho)/.test(text)) return null;
  if (/(prenot|fissa|sposta|rimanda|annulla|cancella|modifica)/.test(text)) return null;
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
  if (!/(serviz|trattament|prezz|cost|tariff)/.test(text)) return null;
  const services = Array.isArray(data.services) ? data.services : [];
  if (!services.length) return "Non risultano servizi configurati.";
  return `Servizi configurati:\n${services.map(service => `${service.name || "Servizio"}${Number.isFinite(Number(service.price)) ? ` — €${Number(service.price).toFixed(2)}` : ""}${service.duration ? ` — ${service.duration} min` : ""}`).join("\n")}`;
}

function clientsAnswer(message, data) {
  const text = normalize(message);
  if (!/(quanti client|numero client|elenco client|lista client)/.test(text)) return null;
  const clients = Array.isArray(data.clients) ? data.clients : [];
  if (/elenco|lista/.test(text) && clients.length) return `Hai ${clients.length} clienti:\n${clients.map(client => client.name || "Cliente").join("\n")}`;
  return `Hai ${clients.length} ${clients.length === 1 ? "cliente" : "clienti"} in archivio.`;
}

function promotionsAnswer(message, data) {
  const text = normalize(message);
  if (!/(promozion|promo|offert)/.test(text)) return null;
  const promotions = Array.isArray(data.promotions) ? data.promotions : [];
  if (!promotions.length) return "Non risultano promozioni attive configurate.";
  return `Promozioni configurate:\n${promotions.map(item => `${item.title || "Promozione"}${item.valid ? ` — ${item.valid}` : ""}`).join("\n")}`;
}

export function answerFastLocalData(message, data = {}, now = new Date()) {
  const answer = todayPlanAnswer(message, data, now)
    || appointmentAnswer(message, data, now)
    || clientsAnswer(message, data)
    || servicesAnswer(message, data)
    || promotionsAnswer(message, data);
  return answer ? { handled: true, answer } : { handled: false, answer: "" };
}
