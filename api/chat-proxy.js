import chatHandler from "./chat.js";

const clean = value => String(value ?? "").trim();
const norm = value => clean(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");

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

function customerStats(body = {}) {
  const clients = Array.isArray(body.clients) ? body.clients.filter(Boolean) : [];
  const appointments = Array.isArray(body.appointments) ? body.appointments.filter(Boolean) : [];
  const clientsById = new Map(clients.map(client => [clean(client?.id), client]));
  const stats = new Map();

  const ensure = (name, client = null) => {
    const key = norm(name);
    if (!key) return null;
    if (!stats.has(key)) {
      stats.set(key, { name: clean(name), visits: 0, lastVisit: "", client });
    } else if (client && !stats.get(key).client) {
      stats.get(key).client = client;
    }
    return stats.get(key);
  };

  for (const client of clients) ensure(client?.name, client);

  for (const appointment of appointments) {
    const status = norm(appointment?.status || "confirmed");
    if (["cancelled", "canceled", "annullato", "cancellato", "deleted"].includes(status)) continue;

    const date = appointmentDate(appointment);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const name = appointmentName(appointment, clientsById);
    const stat = ensure(name, clientsById.get(clean(appointment?.clientId)) || null);
    if (!stat) continue;

    // Customer intelligence is based on visits that already happened, not future bookings.
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Rome",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
    if (date > today) continue;

    stat.visits += 1;
    if (!stat.lastVisit || date > stat.lastVisit) stat.lastVisit = date;
  }

  return [...stats.values()];
}

export function ownerCustomerInsight(body = {}) {
  if (clean(body.action) !== "chat") return null;
  const role = norm(body.role || body.mode || "owner");
  if (role === "client") return null;

  const message = norm(body.message);
  const asksRegular = /client.*abitual|abitual.*client|client.*fedel|fedel.*client|client.*frequent|frequent.*client/.test(message);
  const asksInactive = /client.*non (?:vengono|viene|tornano|torna)|client.*da un po|client.*tempo|client.*inattiv|inattiv.*client|client.*pers[io]|pers[io].*client/.test(message);
  if (!asksRegular && !asksInactive) return null;

  const stats = customerStats(body);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
  const todayTime = Date.parse(`${today}T12:00:00Z`);

  if (asksRegular) {
    const regulars = stats
      .filter(item => item.visits >= 2)
      .sort((a, b) => b.visits - a.visits || clean(b.lastVisit).localeCompare(clean(a.lastVisit)))
      .slice(0, 10);

    if (!regulars.length) {
      return "Non ho ancora abbastanza storico per individuare clienti abituali. Considero abituale un cliente con almeno 2 visite registrate.";
    }

    return "I clienti più abituali risultano:\n" + regulars
      .map(item => `• ${item.name} — ${item.visits} visite${item.lastVisit ? `, ultima ${item.lastVisit}` : ""}`)
      .join("\n");
  }

  const inactive = stats
    .filter(item => {
      if (!item.lastVisit) return false;
      const last = Date.parse(`${item.lastVisit}T12:00:00Z`);
      return Number.isFinite(last) && (todayTime - last) / 86400000 >= 60;
    })
    .sort((a, b) => clean(a.lastVisit).localeCompare(clean(b.lastVisit)))
    .slice(0, 10);

  if (!inactive.length) {
    return "Non risultano clienti con una visita registrata che mancano da almeno 60 giorni.";
  }

  return "Questi clienti non vengono da almeno 60 giorni:\n" + inactive
    .map(item => `• ${item.name} — ultima visita ${item.lastVisit}`)
    .join("\n");
}

export default async function handler(req, res) {
  if (req?.method === "POST") {
    req.body = normalizeFrontendHours(
      normalizeLifecycleTimestamps(req.body)
    );

    const insight = ownerCustomerInsight(req.body);
    if (insight) {
      return res.status(200).json({
        ok: true,
        mode: "owner",
        local: true,
        engine: "maviri-customer-intelligence-v1",
        answer: insight,
        booking: null
      });
    }
  }

  return chatHandler(req, res);
}
