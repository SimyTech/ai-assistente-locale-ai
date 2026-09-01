import chatProxy from "./chat-proxy.js";

const clean = value => String(value ?? "").trim();

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

export default async function handler(req, res) {
  if (req?.method === "POST") {
    req.body = normalizeExplicitDateTimeMessage(req.body);
  }
  return chatProxy(req, res);
}
