import chatHandler from "./chat.js";
import { isExplicitOwnerChat } from "../lib/assistant-role.js";

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
          : status === "no_show" || status === "no-show" || status === "assente"
            ? clean(appointment.noShowAt)
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
  return !["cancelled", "canceled", "annullato", "cancellato", "deleted", "no_show", "no-show", "assente"]
    .includes(norm(appointment?.status || "confirmed"));
}

function appointmentConfirmed(appointment) {
  return ["", "confirmed", "confermato", "booked"]
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

export function buildRevenueStats(body = {}) {
  const today = todayRome();
  const month = today.slice(0, 7);
  const services = Array.isArray(body.services) ? body.services.filter(Boolean) : [];
  const appointments = Array.isArray(body.appointments) ? body.appointments.filter(Boolean) : [];
  const priceByService = new Map(services.map(service => [norm(service?.name), Number(service?.price || 0)]));
  const priceOf = appointment => {
    const direct = Number(appointment?.price);
    if (Number.isFinite(direct) && direct >= 0) return direct;
    const configured = priceByService.get(norm(appointmentService(appointment)));
    return Number.isFinite(configured) && configured >= 0 ? configured : 0;
  };
  const sum = rows => rows.reduce((total, appointment) => total + priceOf(appointment), 0);

  return {
    todayScheduled: sum(appointments.filter(appointment => appointmentActive(appointment) && appointmentDate(appointment) === today)),
    monthCompleted: sum(appointments.filter(appointment => norm(appointment?.status) === "completed" && appointmentDate(appointment).startsWith(month))),
    monthScheduled: sum(appointments.filter(appointment => appointmentActive(appointment) && appointmentDate(appointment).startsWith(month))),
    currency: "EUR"
  };
}

export function buildServicePerformance(body = {}) {
  const services = Array.isArray(body.services) ? body.services.filter(Boolean) : [];
  const appointments = Array.isArray(body.appointments) ? body.appointments.filter(Boolean) : [];
  const prices = new Map(services.map(service => [norm(service?.name), Number(service?.price || 0)]));
  const rows = new Map();

  for (const appointment of appointments) {
    const name = appointmentService(appointment) || "Servizio non indicato";
    const key = norm(name);
    const directPrice = Number(appointment?.price);
    const price = Number.isFinite(directPrice) && directPrice >= 0
      ? directPrice
      : Math.max(0, Number(prices.get(key) || 0));
    const current = rows.get(key) || { name, completed: 0, noShows: 0, completedValue: 0, lostValue: 0 };
    const status = norm(appointment?.status);
    if (status === "completed") {
      current.completed += 1;
      current.completedValue += price;
    } else if (["no_show", "no-show", "assente"].includes(status)) {
      current.noShows += 1;
      current.lostValue += price;
    }
    rows.set(key, current);
  }

  return [...rows.values()]
    .filter(row => row.completed > 0 || row.noShows > 0)
    .sort((a, b) => b.completedValue - a.completedValue || b.completed - a.completed);
}

export function buildCancellationStats(body = {}) {
  const appointments = Array.isArray(body.appointments) ? body.appointments.filter(Boolean) : [];
  const services = Array.isArray(body.services) ? body.services.filter(Boolean) : [];
  const prices = new Map(services.map(service => [norm(service?.name), Number(service?.price || 0)]));
  const reasons = new Map();
  let total = 0;
  let lostValue = 0;

  for (const appointment of appointments) {
    if (!["cancelled", "canceled", "annullato", "cancellato"].includes(norm(appointment?.status))) continue;
    total += 1;
    const reason = clean(appointment?.cancellationReason || appointment?.cancelReason || "Motivo non indicato");
    const key = norm(reason);
    reasons.set(key, { reason, count: (reasons.get(key)?.count || 0) + 1 });
    const direct = Number(appointment?.price);
    const price = Number.isFinite(direct) && direct >= 0 ? direct : Number(prices.get(norm(appointmentService(appointment))) || 0);
    lostValue += Math.max(0, price);
  }

  return { total, lostValue, reasons: [...reasons.values()].sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)) };
}

export function buildRebookingCandidates(body = {}) {
  const today = todayRome();
  const appointments = Array.isArray(body.appointments) ? body.appointments.filter(Boolean) : [];
  const clients = Array.isArray(body.clients) ? body.clients.filter(Boolean) : [];
  const clientsById = new Map(clients.map(client => [clean(client?.id), client]));
  const histories = new Map();
  for (const appointment of appointments) {
    if (norm(appointment?.status) !== "completed") continue;
    const date = appointmentDate(appointment);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) continue;
    const clientId = clean(appointment?.clientId);
    const name = appointmentName(appointment, clientsById);
    const key = clientId || norm(name);
    if (!key || !name) continue;
    const current = histories.get(key) || { clientId, name, dates: [], services: new Map() };
    current.dates.push(date);
    const service = appointmentService(appointment);
    if (service) current.services.set(service, (current.services.get(service) || 0) + 1);
    histories.set(key, current);
  }
  return [...histories.values()].flatMap(history => {
    const dates = [...new Set(history.dates)].sort();
    if (dates.length < 2) return [];
    const intervals = dates.slice(1).map((date, index) => Math.max(1, Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${dates[index]}T12:00:00Z`)) / 86400000)));
    const averageDays = Math.max(7, Math.round(intervals.reduce((sum, days) => sum + days, 0) / intervals.length));
    const lastVisit = dates.at(-1);
    const expectedDate = addDaysISO(lastVisit, averageDays);
    if (expectedDate > today) return [];
    const hasUpcoming = appointments.some(appointment => (clean(appointment?.clientId) === history.clientId || norm(appointmentName(appointment, clientsById)) === norm(history.name)) && appointmentConfirmed(appointment) && appointmentDate(appointment) >= today);
    if (hasUpcoming) return [];
    const favoriteService = [...history.services.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    return [{ ...history, averageDays, lastVisit, expectedDate, overdueDays: Math.max(0, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${expectedDate}T12:00:00Z`)) / 86400000)), favoriteService }];
  }).sort((a, b) => b.overdueDays - a.overdueDays || a.expectedDate.localeCompare(b.expectedDate));
}

export function buildRebookingPerformance(body = {}) {
  const month = todayRome().slice(0, 7);
  const services = Array.isArray(body.services) ? body.services.filter(Boolean) : [];
  const prices = new Map(services.map(service => [norm(service?.name), Number(service?.price || 0)]));
  const rows = (Array.isArray(body.appointments) ? body.appointments : []).filter(appointment =>
    clean(appointment?.source) === "smart-rebooking" && appointmentDate(appointment).startsWith(month)
  );
  const priceOf = appointment => {
    const direct = Number(appointment?.price);
    return Number.isFinite(direct) && direct >= 0 ? direct : Math.max(0, Number(prices.get(norm(appointmentService(appointment))) || 0));
  };
  const booked = rows.filter(appointmentActive);
  const completed = rows.filter(appointment => norm(appointment?.status) === "completed");
  return {
    booked: booked.length,
    scheduledValue: booked.reduce((sum, appointment) => sum + priceOf(appointment), 0),
    completed: completed.length,
    completedValue: completed.reduce((sum, appointment) => sum + priceOf(appointment), 0)
  };
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
  if (!isExplicitOwnerChat(body)) return null;

  const message = norm(body.message);
  const labels = labelsFor(body);
  const clientPlural = pluralizeItalian(labels.client);
  const appointmentPlural = pluralizeItalian(labels.appointment);
  const entityWords = "client|pazient|soci|socio|ospit|utent|contatt";
  const asksRegular = new RegExp(`(?:${entityWords}).*(?:abitual|fedel|frequent)|(?:abitual|fedel|frequent).*(?:${entityWords})`).test(message);
  const asksInactive = new RegExp(`(?:${entityWords}).*(?:non (?:vengono|viene|tornano|torna)|da un po|da tempo|inattiv|pers[io]|ricontatt|recuper)|(?:inattiv|pers[io]|ricontatt|recuper).*(?:${entityWords})`).test(message);
  const asksBest = new RegExp(`(?:miglior|top|piu important|piu valore).*(?:${entityWords})|(?:${entityWords}).*(?:miglior|top|piu important|piu valore)`).test(message);
  const asksNew = new RegExp(`(?:nuov).*(?:${entityWords})|(?:${entityWords}).*(?:nuov)`).test(message) && /mese|questo mese|ultimi 30/.test(message);
  const asksCount = new RegExp(`quant[ioe].*(?:${entityWords})|numero.*(?:${entityWords})`).test(message);
  const asksNeverVisited = new RegExp(`(?:${entityWords}).*(?:mai venut|mai tornat|senza visit|senza appunt)|(?:mai venut|mai tornat).*(?:${entityWords})`).test(message);
  const asksAgendaList = /(?:^|\b)(?:che|quali|mostra(?:mi)?|elenca(?:mi)?|ho|ci sono|agenda|programma)(?:\b|$)/.test(message);
  const asksTodayAppointments = asksAgendaList && /appuntament|prenotaz|visite|intervent/.test(message) && /oggi/.test(message);
  const asksTomorrowAppointments = asksAgendaList && /appuntament|prenotaz|visite|intervent/.test(message) && /domani/.test(message);
  const asksNoShows = /(?:chi|quali|mostra|elenca|client|pazient|soci|ospit).*(?:non si (?:e|sono) presentat|assenz|assent|no[ -]?show)|(?:assenz|assent|no[ -]?show).*(?:client|pazient|soci|ospit|appuntament|prenotaz|visit)/.test(message);
  const asksNoShowRisk = /(?:chi|quali|client|pazient|soci|ospit).*(?:piu assenz|piu no[ -]?show|saltano piu|meno affidabil)|(?:classifica|graduatoria|ranking).*(?:assenz|no[ -]?show|affidabil)/.test(message);
  const asksReminders = /(?:promemori|ricord).*(?:invia|fare|prepar|manc|domani)|(?:chi|quali|mostra|elenca).*(?:promemori|ricord)/.test(message);
  const asksPendingActions = /(?:cosa|che).*(?:devo|c'e da|ce da).*(?:fare|gestire|chiudere)|azion[ei].*(?:pendent|operativ|oggi)|appuntament.*(?:da chiudere|rimast.*apert)/.test(message);
  const asksSummary = /riepilogo|come va(?: l)?(?: attivita|azienda|lavoro)|situazione(?: di oggi| attivita)?|panoramica/.test(message);
  const asksRevenue = /(?:quanto|valore|totale|stima).*(?:incass|fatturat|guadagn|agenda)|(?:incass|fatturat|guadagn).*(?:oggi|mese|questo mese|quanto|totale)/.test(message);
  const asksServicePerformance = /(?:serviz|prestaz|trattament|intervent|lezion).*(?:reddit|rende|incass|valore|richiest|miglior)|(?:quale|quali|classifica).*(?:serviz|prestaz|trattament|intervent|lezion)/.test(message);
  const asksLostValue = /(?:quanto|valore|soldi|incasso).*(?:pers[io]|perdo|mancat).*(?:assenz|no[ -]?show)|(?:assenz|no[ -]?show).*(?:cost|valore|pers[io]|perdo)/.test(message);
  const asksCancellations = /(?:perche|motivi?|cause?).*(?:annull|cancell)|(?:annull|cancell).*(?:motivi?|cause?|quanto|valore|pers[io])/.test(message);
  const asksRebooking = /(?:chi|quali|client|pazient|soci|ospit).*(?:dovrebbe tornare|devono tornare|da richiamare|richiamo|richiama|scadut|in ritardo)|(?:richiamo|richiama).*(?:intelligent|client|pazient|soci|ospit)/.test(message);
  const asksRebookingPerformance = /(?:quanto|valore|soldi|incass|rend|risultat|appuntament).*(?:recuperat|richiam)|(?:recuperat|richiam).*(?:quanto|valore|soldi|incass|rend|risultat|appuntament)/.test(message);

  if (!asksRegular && !asksInactive && !asksBest && !asksNew && !asksCount && !asksNeverVisited && !asksTodayAppointments && !asksTomorrowAppointments && !asksNoShows && !asksNoShowRisk && !asksReminders && !asksPendingActions && !asksSummary && !asksRevenue && !asksServicePerformance && !asksLostValue && !asksCancellations && !asksRebooking && !asksRebookingPerformance) {
    return null;
  }

  const stats = buildCustomerStats(body);
  const today = todayRome();
  const todayTime = Date.parse(`${today}T12:00:00Z`);
  const tomorrow = addDaysISO(today, 1);
  const appointments = Array.isArray(body.appointments) ? body.appointments.filter(Boolean) : [];
  const clients = Array.isArray(body.clients) ? body.clients.filter(Boolean) : [];
  const clientsById = new Map(clients.map(client => [clean(client?.id), client]));

  if (asksRebookingPerformance) {
    const result = buildRebookingPerformance(body);
    return [
      "Risultati dei richiami intelligenti questo mese:",
      `• Appuntamenti ottenuti: ${result.booked}`,
      `• Valore in agenda: €${result.scheduledValue.toFixed(2)}`,
      `• Appuntamenti completati: ${result.completed}`,
      `• Valore realmente completato: €${result.completedValue.toFixed(2)}`
    ].join("\n");
  }

  if (asksRebooking) {
    const rows = buildRebookingCandidates(body).slice(0, 10);
    if (!rows.length) return `Non risultano ${clientPlural.toLowerCase()} in ritardo rispetto alla loro frequenza abituale.`;
    return `Richiami intelligenti — ${clientPlural.toLowerCase()} da ricontattare:\n` + rows.map(item =>
      `• ${item.name} — atteso il ${item.expectedDate}, ${item.overdueDays} ${item.overdueDays === 1 ? "giorno" : "giorni"} di ritardo${item.favoriteService ? `, servizio abituale: ${item.favoriteService}` : ""}`
    ).join("\n");
  }

  if (asksCancellations) {
    const stats = buildCancellationStats(body);
    if (!stats.total) return "Non risultano appuntamenti annullati.";
    return [
      `Appuntamenti annullati: ${stats.total}`,
      `Valore potenziale annullato: €${stats.lostValue.toFixed(2)}`,
      "Motivi più frequenti:",
      ...stats.reasons.slice(0, 10).map(item => `• ${item.reason} — ${item.count}`)
    ].join("\n");
  }

  if (asksLostValue) {
    const rows = buildServicePerformance(body).filter(row => row.noShows > 0);
    const total = rows.reduce((sum, row) => sum + row.lostValue, 0);
    if (!rows.length) return "Non risultano valori persi per assenze/no-show.";
    return `Valore stimato perso per assenze/no-show: €${total.toFixed(2)}\n` + rows
      .sort((a, b) => b.lostValue - a.lostValue)
      .map(row => `• ${row.name} — ${row.noShows} ${row.noShows === 1 ? "assenza" : "assenze"}, €${row.lostValue.toFixed(2)} persi`)
      .join("\n");
  }

  if (asksServicePerformance) {
    const rows = buildServicePerformance(body).filter(row => row.completed > 0).slice(0, 10);
    if (!rows.length) return "Non ci sono ancora prestazioni completate sufficienti per confrontare i servizi.";
    return "Servizi per valore generato:\n" + rows.map((row, index) =>
      `${index + 1}. ${row.name} — ${row.completed} completati, €${row.completedValue.toFixed(2)}`
    ).join("\n");
  }

  if (asksRevenue) {
    const revenue = buildRevenueStats(body);
    return [
      "Valore economico stimato:",
      `• Agenda di oggi: €${revenue.todayScheduled.toFixed(2)}`,
      `• Prestazioni completate questo mese: €${revenue.monthCompleted.toFixed(2)}`,
      `• Agenda complessiva del mese: €${revenue.monthScheduled.toFixed(2)}`,
      "La stima usa i prezzi dei servizi configurati e non sostituisce la contabilità fiscale."
    ].join("\n");
  }

  if (asksNoShowRisk) {
    const priceByService = new Map((Array.isArray(body.services) ? body.services : []).map(service => [norm(service?.name), Number(service?.price || 0)]));
    const ranked = new Map();
    for (const appointment of appointments) {
      if (!["no_show", "no-show", "assente"].includes(norm(appointment?.status))) continue;
      const name = appointmentName(appointment, clientsById) || "Senza nome";
      const key = norm(name);
      const current = ranked.get(key) || { name, count: 0, lostValue: 0 };
      current.count += 1;
      current.lostValue += priceByService.get(norm(appointmentService(appointment))) || 0;
      ranked.set(key, current);
    }
    const rows = [...ranked.values()].sort((a, b) => b.count - a.count || b.lostValue - a.lostValue).slice(0, 10);
    if (!rows.length) return `Non risultano ${clientPlural.toLowerCase()} con assenze/no-show registrati.`;
    return `${clientPlural} con più assenze/no-show:\n` + rows.map(item =>
      `• ${item.name} — ${item.count} ${item.count === 1 ? "assenza" : "assenze"}${item.lostValue > 0 ? `, valore stimato perso €${item.lostValue.toFixed(2)}` : ""}`
    ).join("\n");
  }

  if (asksNoShows) {
    const rows = appointments
      .filter(appointment => ["no_show", "no-show", "assente"].includes(norm(appointment?.status)))
      .sort((a, b) => `${appointmentDate(b)}${appointmentTime(b)}`.localeCompare(`${appointmentDate(a)}${appointmentTime(a)}`))
      .slice(0, 10);
    if (!rows.length) return `Non risultano assenze/no-show registrati.`;
    return `Assenze/no-show registrati:\n` + rows.map(appointment =>
      `• ${appointmentDate(appointment)} ${appointmentTime(appointment) || "--:--"} — ${appointmentName(appointment, clientsById) || "Senza nome"}${appointmentService(appointment) ? ` — ${appointmentService(appointment)}` : ""}`
    ).join("\n");
  }

  if (asksReminders) {
    const rows = appointments
      .filter(appointment => appointmentConfirmed(appointment) && appointmentDate(appointment) === tomorrow && !appointment?.reminderSentAt)
      .sort((a, b) => appointmentTime(a).localeCompare(appointmentTime(b)));
    if (!rows.length) return `Non risultano promemoria da inviare per domani.`;
    return `Promemoria da inviare per domani:\n` + rows.map(appointment =>
      `• ${appointmentTime(appointment) || "--:--"} — ${appointmentName(appointment, clientsById) || "Senza nome"}${appointmentService(appointment) ? ` — ${appointmentService(appointment)}` : ""}`
    ).join("\n");
  }

  if (asksPendingActions) {
    const overdue = appointments.filter(appointment => appointmentConfirmed(appointment) && appointmentDate(appointment) < today);
    const reminders = appointments.filter(appointment => appointmentConfirmed(appointment) && appointmentDate(appointment) === tomorrow && !appointment?.reminderSentAt);
    return [
      `Azioni operative pendenti:`,
      `• ${appointmentPlural} passati da chiudere: ${overdue.length}`,
      `• Promemoria da inviare per domani: ${reminders.length}`
    ].join("\n");
  }

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
    const recentContactLimit = todayTime - 30 * 86400000;
    const inactive = stats
      .filter(item => {
        if (!item.lastVisit) return false;
        const last = Date.parse(`${item.lastVisit}T12:00:00Z`);
        const contacted = Date.parse(clean(item.client?.recoveryContactedAt));
        const hasUpcoming = appointments.some(appointment => clean(appointment?.clientId) === clean(item.client?.id) && appointmentConfirmed(appointment) && appointmentDate(appointment) >= today);
        return Number.isFinite(last) && (todayTime - last) / 86400000 >= 60 && !hasUpcoming && (!Number.isFinite(contacted) || contacted < recentContactLimit);
      })
      .sort((a, b) => clean(a.lastVisit).localeCompare(clean(b.lastVisit)))
      .slice(0, 10);

    if (!inactive.length) {
      return `Non risultano ${clientPlural.toLowerCase()} con una visita registrata che mancano da almeno 60 giorni.`;
    }

    return `Questi ${clientPlural.toLowerCase()} sono da ricontattare: non tornano da almeno 60 giorni, non hanno un prossimo appuntamento e non sono stati contattati negli ultimi 30 giorni:\n` + inactive
      .map(item => `• ${item.name} — ultima visita ${item.lastVisit}`)
      .join("\n");
  }

  if (asksSummary) {
    const revenue = buildRevenueStats(body);
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
    const noShows = appointments.filter(appointment => ["no_show", "no-show", "assente"].includes(norm(appointment?.status))).length;
    const pendingReminders = appointments.filter(appointment => appointmentConfirmed(appointment) && appointmentDate(appointment) === tomorrow && !appointment?.reminderSentAt).length;

    return [
      `Riepilogo ${clean(body.business?.name) || "attività"}:`,
      `• ${appointmentPlural} oggi: ${todayAppointments.length}`,
      `• Visite/prestazioni registrate questo mese: ${monthVisits}`,
      `• Nuovi ${clientPlural.toLowerCase()} questo mese: ${newClients}`,
      `• ${clientPlural} da recuperare (60+ giorni): ${inactive}`,
      `• Assenze/no-show registrati: ${noShows}`,
      `• Promemoria da inviare per domani: ${pendingReminders}`,
      `• Valore completato questo mese: €${revenue.monthCompleted.toFixed(2)}`
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
