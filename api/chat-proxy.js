import chatHandler from "./chat.js";

const clean = value => String(value ?? "").trim();

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

export default async function handler(req, res) {
  if (req?.method === "POST") {
    req.body = normalizeFrontendHours(
      normalizeLifecycleTimestamps(req.body)
    );
  }

  return chatHandler(req, res);
}
