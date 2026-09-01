import chatHandler from "./chat.js";

const clean = value => String(value ?? "").trim();
const norm = value => clean(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");

const todayRome = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Rome",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
}).format(new Date());

function addDaysISO(isoDate, amount) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}

function latestIso(...values) {
  let best = "";
  let bestTime = 0;

  for (const value of values) {
    const text = clean(value);
    const time = Date.parse(text) || 0;
    if (time > bestTime) {
      best = text;
      bestTime = time;
    }
  }

  return best;
}

export function normalizeLifecycleTimestamps(body = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  if (clean(body.action) !== "owner-sync") return body;
  if (!Array.isArray(body.appointments)) return body;

  const datasetUpdatedAt = clean(body.updatedAt);

  return {
    ...body,
    appointments: body.appointments.map(appointment => {
      if (!appointment || typeof appointment !== "object" || Array.isArray(appointment)) {
        return appointment;
      }

      const status = clean(appointment.status).toLowerCase();
      const lifecycleAt =
        status === "completed"
          ? clean(appointment.completedAt)
          : status === "cancelled" || status === "canceled"
            ? clean(appointment.cancelledAt)
            : "";

      if (!lifecycleAt) return appointment;

      return {
        ...appointment,
        updatedAt:
          latestIso(appointment.updatedAt, lifecycleAt, datasetUpdatedAt) ||
          lifecycleAt
      };
    })
  };
}

export function normalizeFrontendHours(body = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  if (!body.settings || typeof body.settings !== "object" || Array.isArray(body.settings)) return body;
  if (!Array.isArray(body.settings.hours)) return body;

  const keys = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday"
  ];

  const hours = Object.fromEntries(
    keys.map((key, index) => {
      const source = body.settings.hours[index];
      return [
        key,
        source && typeof source === "object" && !Array.isArray(source)
          ? source
          : { closed: true }
      ];
    })
  );

  return {
    ...body,
    settings: {
      ...body.settings,
      hours
    }
  };
}

function appointmentDate(appointment) {
  return clean(appointment?.date || appointment?.d);
}

function appointmentTime(appointment) {
  return clean(appointment?.time || appointment?.t);
}

function appointmentService(appointment) {
  return clean(appointment?.service || appointment?.serviceName || appointment?.s);
}

function appointmentActive(appointment) {
  return !["cancelled", "canceled", "annullato", "cancellato", "deleted"]
    .includes(norm(appointment?.status || "confirmed"));
}

function appointmentName(appointment, clientsById) {
  const direct = clean(
    appointment?.name ||
    appointment?.clientName ||
    appointment?.customerName ||
    appointment?.customer
  );
  if (direct) return direct;
  const clientId = clean(appointment?.clientId);
  return clean(clientsById.get(clientId)?.name);
}

function labelsFor(body = {}) {
  const labels = body.activityProfile?.labels || body.profile?.labels || {};
  return {
    client: clean(labels.client) || "Cliente",
    appointment: clean(labels.appointment) || "Appuntamento",
    service: clean(labels.service) || "Servizio"
  };
}

function pluralizeItalian(value) {
  const text = clean(value);
  const lower = text.toLowerCase();
  const known = {
    cliente: "Clienti",
    paziente: "Pazienti",
    socio: "Soci",
    ospite: "Ospiti",
    appuntamento: "Appuntamenti",
    prenotazione: "Prenotazioni",
    visita: "Visite",
    servizio: "Servizi",
    prestazione: "Prestazioni",
    intervento: "Interventi",
    lezione: "Lezioni"
  };
  if (known[lower]) return known[lower];
  if (/io$/i.test(text)) return `${text.slice(0, -2)}i`;
  if (/o$/i.test(text)) return `${text.slice(0, -1)}i`;
  if (/a$/i.test(text)) return `${text.slice(0, -1)}e`;
  if (/e$/i.test(text)) return `${text.slice(0, -1)}i`;
  return text;
}

export function buildCustomerStats(body = {}) {
  const clients = Array.isArray(body.clients) ? body.clients.filter(Boolean) : [];
  const appointments = Array.isArray(body.appointments) ? body.appointments.filter(Boolean) : [];
  const services = Array.isArray(body.services) ? body.services.filter(Boolean) : [];
  const clientsById = new Map(clients.map(client => [clean(client?.id), client]));
  const priceByService = new Map(services.map(service => [norm(service?.name), Number(service?.price || 0)]));
  const stats = new Map();
  const today = todayRome();

  const ensure = (name, client = null) => {
    const key = norm(name);
    if (!key) return null;
    if (!stats.has(key)) {
      stats.set(key, {
        name: clean(name),
        visits: 0,
        firstVisit: "",
        lastVisit: "",
        estimatedValue: 0,
        client
      });
    } else if (client && !stats.get(key).client) {
      stats.get(key).client = client;
    }
    return stats.get(key);
  };

  for (const client of clients) ensure(client?.name, client);

  for (const appointment of appointments) {
    if (!appointmentActive(appointment)) continue;
    const date = appointmentDate(appointment);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) continue;

    const name = appointmentName(appointment, clientsById);
    const stat = ensure(name, clientsById.get(clean(appointment?.clientId)) || null);
    if (!stat) continue;

    stat.visits += 1;
    if (!stat.firstVisit || date < stat.firstVisit) stat.firstVisit = date;
    if (!stat.lastVisit || date > stat.lastVisit) stat.lastVisit = date;
    stat.estimatedValue += priceByService.get(norm(appointmentService(appointment))) || 0;
  }

  return [...stats.values()];
}

function listAppointments(body, date) {
  const clients = Array.isArray(body.clients) ? body.clients.filter(Boolean) : [];
  const clientsById = new Map(clients.map(client => [clean(client?.id), client]));
  return (Array.isArray(body.appointments) ? body.appointments : [])
    .filter(appointment => appointmentActive(appointment) && appointmentDate(appointment) === date)
    .sort((a, b) => appointmentTime(a).localeCompare(appointmentTime(b)))
    .map(appointment => ({
      time: appointmentTime(appointment),
      name: appointmentName(appointment, clientsById) || "Senza nome",
      service: appointmentService(appointment)
    }));
}

export function ownerManagerInsight(body = {}) {
  if (clean(body.action) !== "chat") return null;
  const role = norm(body.role || body.mode || "owner");
  if (role === "client") return null;

  const message = norm(body.message);
  const labels = labelsFor(body);
  const clientPlural = pluralizeItalian(labels.client);
  const appointmentPlural = pluralizeItalian(labels.appointment);
  const entityWords = "client|pazient|soci|socio|ospit|utent|contatt";
  const asksRegular = new RegExp(`(?:${entityWords}).*(?:abitual|fedel|frequent)|(?:abitual|fedel|frequent).*(?:${entityWords})`).test(message);
  const asksInactive = new RegExp(`(?:${entityWords}).*(?:non (?:vengono|viene|tornano|torna)|da un po|da tempo|inattiv|pers[io])|(?:inattiv|pers[io]).*(?:${entityWords})`).test(message);
  const asksBest = new RegExp(`(?:miglior|top|piu important|piu valore).*(?:${entityWords})|(?:${entityWords}).*(?:miglior|top|piu important|piu valore)`).test(message);
  const asksNew = new RegExp(`(?:nuov).*(?:${entityWords})|(?:${entityWords}).*(?:nuov)`).test(message) && /mese|questo mese|ultimi 30/.test(message);
  const asksCount = new RegExp(`quant[ioe].*(?:${entityWords})|numero.*(?:${entityWords})`).test(message);
  const asksNeverVisited = new RegExp(`(?:${entityWords}).*(?:mai venut|mai tornat|senza visit|senza appunt)|(?:mai venut|mai tornat).*(?:${entityWords})`).test(message);
  const asksAgendaList = /(?:^|\b)(?:che|quali|mostra(?:mi)?|elenca(?:mi)?|ho|ci sono|agenda|programma)(?:\b|$)/.test(message);
  const asksTodayAppointments = asksAgendaList && /appuntament|prenotaz|visite|intervent/.test(message) && /oggi/.test(message);
  const asksTomorrowAppointments = asksAgendaList && /appuntament|prenotaz|visite|intervent/.test(message) && /domani/.test(message);
  const asksSummary = /riepilogo|come va(?: l)?(?: attivita|azienda|lavoro)|situazione(?: di oggi| attivita)?|panoramica/.test(message);

  if (!asksRegular && !asksInactive && !asksBest && !asksNew && !asksCount && !asksNeverVisited && !asksTodayAppointments && !asksTomorrowAppointments && !asksSummary) {
    return null;
  }

  const stats = buildCustomerStats(body);
  const today = todayRome();
  const todayTime = Date.parse(`${today}T12:00:00Z`);

  if (asksTodayAppointments || asksTomorrowAppointments) {
    const date = asksTomorrowAppointments ? addDaysISO(today, 1) : today;
    const rows = listAppointments(body, date);
    if (!rows.length) return `Non risultano ${appointmentPlural.toLowerCase()} per il ${date}.`;
    return `${appointmentPlural} del ${date}:\n` + rows
      .map(row => `• ${row.time || "--:--"} — ${row.name}${row.service ? ` — ${row.service}` : ""}`)
      .join("\n");
  }

  if (asksCount) {
    const total = (Array.isArray(body.clients) ? body.clients : []).filter(client => clean(client?.name)).length;
    return `In archivio risultano ${total} ${clientPlural.toLowerCase()}.`;
  }

  if (asksNew) {
    const month = today.slice(0, 7);
    const newcomers = stats
      .filter(item => item.firstVisit?.startsWith(month))
      .sort((a, b) => clean(b.firstVisit).localeCompare(clean(a.firstVisit)))
      .slice(0, 10);
    if (!newcomers.length) return `Non risultano nuovi ${clientPlural.toLowerCase()} con prima visita registrata questo mese.`;
    return `Nuovi ${clientPlural.toLowerCase()} questo mese:\n` + newcomers
      .map(item => `• ${item.name} — prima visita ${item.firstVisit}`)
      .join("\n");
  }

  if (asksNeverVisited) {
    const never = stats.filter(item => item.visits === 0 && item.name).slice(0, 10);
    if (!never.length) return `Non risultano ${clientPlural.toLowerCase()} in archivio senza alcuna visita registrata.`;
    return `${clientPlural} senza visite registrate:\n` + never.map(item => `• ${item.name}`).join("\n");
  }

  if (asksBest) {
    const best = stats
      .filter(item => item.visits > 0)
      .sort((a, b) => b.estimatedValue - a.estimatedValue || b.visits - a.visits || clean(b.lastVisit).localeCompare(clean(a.lastVisit)))
      .slice(0, 10);
    if (!best.length) return `Non ho ancora abbastanza storico per individuare i migliori ${clientPlural.toLowerCase()}.`;
    return `I ${clientPlural.toLowerCase()} con maggiore valore storico risultano:\n` + best
      .map(item => `• ${item.name} — ${item.visits} visite${item.estimatedValue > 0 ? `, valore stimato €${item.estimatedValue.toFixed(2)}` : ""}`)
      .join("\n");
  }

  if (asksRegular) {
    const regulars = stats
      .filter(item => item.visits >= 2)
      .sort((a, b) => b.visits - a.visits || clean(b.lastVisit).localeCompare(clean(a.lastVisit)))
      .slice(0, 10);

    if (!regulars.length) {
      return `Non ho ancora abbastanza storico per individuare ${clientPlural.toLowerCase()} abituali. Considero abituale chi ha almeno 2 visite registrate.`;
    }

    return `I ${clientPlural.toLowerCase()} più abituali risultano:\n` + regulars
      .map(item => `• ${item.name} — ${item.visits} visite${item.lastVisit ? `, ultima ${item.lastVisit}` : ""}`)
      .join("\n");
  }

  if (asksInactive) {
    const inactive = stats
      .filter(item => {
        if (!item.lastVisit) return false;
        const last = Date.parse(`${item.lastVisit}T12:00:00Z`);
        return Number.isFinite(last) && (todayTime - last) / 86400000 >= 60;
      })
      .sort((a, b) => clean(a.lastVisit).localeCompare(clean(b.lastVisit)))
      .slice(0, 10);

    if (!inactive.length) {
      return `Non risultano ${clientPlural.toLowerCase()} con una visita registrata che mancano da almeno 60 giorni.`;
    }

    return `Questi ${clientPlural.toLowerCase()} non tornano da almeno 60 giorni:\n` + inactive
      .map(item => `• ${item.name} — ultima visita ${item.lastVisit}`)
      .join("\n");
  }

  if (asksSummary) {
    const todayAppointments = listAppointments(body, today);
    const month = today.slice(0, 7);
    const monthVisits = (Array.isArray(body.appointments) ? body.appointments : [])
      .filter(appointment => appointmentActive(appointment) && appointmentDate(appointment).startsWith(month) && appointmentDate(appointment) <= today).length;
    const newClients = stats.filter(item => item.firstVisit?.startsWith(month)).length;
    const inactive = stats.filter(item => {
      if (!item.lastVisit) return false;
      const last = Date.parse(`${item.lastVisit}T12:00:00Z`);
      return Number.isFinite(last) && (todayTime - last) / 86400000 >= 60;
    }).length;

    return [
      `Riepilogo ${clean(body.business?.name) || "attività"}:`,
      `• ${appointmentPlural} oggi: ${todayAppointments.length}`,
      `• Visite/prestazioni registrate questo mese: ${monthVisits}`,
      `• Nuovi ${clientPlural.toLowerCase()} questo mese: ${newClients}`,
      `• ${clientPlural} da recuperare (60+ giorni): ${inactive}`
    ].join("\n");
  }

  return null;
}

export const ownerCustomerInsight = ownerManagerInsight;

export default async function handler(req, res) {
  if (req?.method === "POST") {
    req.body = normalizeFrontendHours(
      normalizeLifecycleTimestamps(req.body)
    );

    const insight = ownerManagerInsight(req.body);
    if (insight) {
      return res.status(200).json({
        ok: true,
        mode: "owner",
        local: true,
        engine: "maviri-owner-intelligence-v2",
        answer: insight,
        booking: null
      });
    }
  }

  return chatHandler(req, res);
}
