import chatHandler from "./chat.js";

const clean = value => String(value ?? "").trim();

const DIRECT_OPERATION_ACTIONS = new Set([
  "availability",
  "book",
  "update",
  "cancel",
  "confirm-attendance",
  "client",
  "context",
  "public-context",
  "owner-pull"
]);

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

export function normalizeOwnerSync(body = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  if (clean(body.action) !== "owner-sync") return body;

  let next = body;

  if (Array.isArray(next.appointments)) {
    const datasetUpdatedAt = clean(next.updatedAt);
    next = {
      ...next,
      appointments: next.appointments.map(appointment => {
        if (!appointment || typeof appointment !== "object" || Array.isArray(appointment)) return appointment;

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
          updatedAt: latestIso(appointment.updatedAt, lifecycleAt, datasetUpdatedAt) || lifecycleAt
        };
      })
    };
  }

  if (
    next.settings &&
    typeof next.settings === "object" &&
    !Array.isArray(next.settings) &&
    Array.isArray(next.settings.hours)
  ) {
    const keys = [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday"
    ];

    next = {
      ...next,
      settings: {
        ...next.settings,
        hours: Object.fromEntries(
          keys.map((key, index) => {
            const source = next.settings.hours[index];
            return [
              key,
              source && typeof source === "object" && !Array.isArray(source)
                ? source
                : { closed: true }
            ];
          })
        )
      }
    };
  }

  return next;
}

export function normalizeExplicitDateTimeMessage(body = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  if (clean(body.action) !== "chat") return body;

  const message = clean(body.message);
  if (!message) return body;

  const hasExplicitDate = /\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/.test(message);
  if (!hasExplicitDate) return body;

  const explicitTime = message.match(/\b(?:ore|alle|h)\s*([01]?\d|2[0-3])(?:[:.]([0-5]\d))?\b/i);
  if (!explicitTime) return body;

  const hour = String(Number(explicitTime[1])).padStart(2, "0");
  const minute = String(explicitTime[2] || "00").padStart(2, "0");
  const prefix = `ore ${hour}:${minute}`;

  if (message.toLowerCase().startsWith(prefix.toLowerCase())) return body;

  return {
    ...body,
    message: `${prefix} ${message}`
  };
}

export function isDirectOperationalAction(body = {}) {
  return DIRECT_OPERATION_ACTIONS.has(clean(body?.action));
}

export default async function handler(req, res) {
  if (req?.method === "POST") {
    req.body = normalizeOwnerSync(normalizeExplicitDateTimeMessage(req.body));

    if (isDirectOperationalAction(req.body)) {
      res.setHeader("X-Maviri-Path", "direct-operation");
      return chatHandler(req, res);
    }

    if (clean(req.body?.action) === "owner-sync") {
      res.setHeader("X-Maviri-Path", "direct-owner-sync");
      return chatHandler(req, res);
    }

    const { buildOperationalChatResponse } = await import("../lib/operational-chat.js");
    const operational = buildOperationalChatResponse(req.body);
    if (operational) {
      return res.status(200).json({
        ok: true,
        mode: "owner",
        local: true,
        engine: "maviri-operational-center-v1",
        answer: operational.answer,
        operationalCenter: operational.center,
        booking: null
      });
    }
  }

  const { default: chatProxy } = await import("./chat-proxy.js");
  return chatProxy(req, res);
}
