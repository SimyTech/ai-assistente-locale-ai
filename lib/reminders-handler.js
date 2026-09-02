/* MAVIRI — AUTOMATIC APPOINTMENT REMINDER DISPATCH */

import {
  markReminderSent,
  planAppointmentReminders,
  pruneReminderState
} from "./appointment-reminders.js";
import {
  reminderStateKey,
  tenantIdFromOwnerDataKey,
  tenantOwnerDataKeys,
  whatsappPhoneNumberIdForTenant
} from "./reminder-dispatch.js";
import { tenantDataKey } from "./tenant.js";

const clean = value => String(value ?? "").replace(/\u0000/g, "").trim();
const redisUrl = () => process.env.UPSTASH_REDIS_REST_URL || "";
const redisToken = () => process.env.UPSTASH_REDIS_REST_TOKEN || "";

function json(res, status, payload) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(payload);
}

function authorized(req) {
  const configured = clean(process.env.CRON_SECRET || process.env.MAVIRI_REMINDER_SECRET);
  if (!configured) return false;
  const auth = clean(req.headers?.authorization);
  const explicit = clean(req.headers?.["x-maviri-reminder-secret"]);
  return auth === `Bearer ${configured}` || explicit === configured;
}

async function redisCommand(command, ...args) {
  if (!redisUrl() || !redisToken()) throw new Error("Upstash Redis non configurato.");
  const response = await fetch(redisUrl(), {
    method: "POST",
    headers: { Authorization: `Bearer ${redisToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify([command, ...args])
  });
  if (!response.ok) throw new Error(`Redis HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(String(payload.error));
  return payload.result;
}

async function redisGet(key) {
  const value = await redisCommand("GET", key);
  if (value === null || value === undefined || value === "") return null;
  try { return JSON.parse(value); } catch { return value; }
}

async function redisSet(key, value) {
  return redisCommand("SET", key, JSON.stringify(value));
}

async function discoverTenantDataKeys() {
  const found = new Set([tenantDataKey("default")]);
  let cursor = "0";
  do {
    const result = await redisCommand("SCAN", cursor, "MATCH", "maviri:tenant:*:owner-data", "COUNT", "200");
    if (!Array.isArray(result) || result.length < 2) break;
    cursor = String(result[0] ?? "0");
    for (const key of Array.isArray(result[1]) ? result[1] : []) found.add(clean(key));
  } while (cursor !== "0");
  return [...found].filter(Boolean);
}

async function sendWhatsApp(to, message, phoneNumberId) {
  const token = clean(process.env.WHATSAPP_ACCESS_TOKEN);
  const senderId = clean(phoneNumberId);
  if (!token || !senderId) return { sent: false, reason: "whatsapp-not-configured" };
  const response = await fetch(`https://graph.facebook.com/v23.0/${senderId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: clean(to),
      type: "text",
      text: { preview_url: false, body: clean(message) }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `WhatsApp HTTP ${response.status}`);
  return { sent: true, id: clean(payload?.messages?.[0]?.id) || null };
}

async function processTenant(dataKey, now) {
  const tenantId = tenantIdFromOwnerDataKey(dataKey);
  const data = await redisGet(dataKey);
  if (!data || typeof data !== "object") {
    return { tenantId, skipped: true, reason: "no-data", due: 0, sent: 0 };
  }

  const appointments = Array.isArray(data.appointments) ? data.appointments : [];
  const stateKey = reminderStateKey(tenantId);
  let state = pruneReminderState(await redisGet(stateKey), appointments);
  const plan = planAppointmentReminders({ appointments, state, now });
  const results = [];
  const phoneNumberId = whatsappPhoneNumberIdForTenant(tenantId, process.env);

  for (const reminder of plan.due) {
    try {
      const delivery = await sendWhatsApp(reminder.recipient, reminder.message, phoneNumberId);
      if (delivery.sent) {
        state = markReminderSent(state, reminder, now.toISOString());
        await redisSet(stateKey, state);
      }
      results.push({
        key: reminder.key,
        appointmentId: reminder.appointmentId,
        ruleId: reminder.ruleId,
        sent: delivery.sent,
        reason: delivery.reason || null,
        messageId: delivery.id || null
      });
    } catch (error) {
      results.push({
        key: reminder.key,
        appointmentId: reminder.appointmentId,
        ruleId: reminder.ruleId,
        sent: false,
        reason: clean(error?.message) || "delivery-error"
      });
    }
  }

  await redisSet(stateKey, state);
  return {
    tenantId,
    phoneNumberId: phoneNumberId || null,
    skipped: false,
    due: plan.due.length,
    sent: results.filter(item => item.sent).length,
    results
  };
}

export default async function reminderHandler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return json(res, 405, { ok: false, error: "Method Not Allowed" });
  }
  if (!authorized(req)) return json(res, 401, { ok: false, error: "Non autorizzato." });

  try {
    const now = new Date();
    const explicitTenant = clean(req.query?.tenant || req.body?.tenantId || req.body?.tenant);
    const keys = explicitTenant ? tenantOwnerDataKeys([explicitTenant]) : await discoverTenantDataKeys();
    const tenants = [];
    for (const key of keys) tenants.push(await processTenant(key, now));
    return json(res, 200, {
      ok: true,
      timestamp: now.toISOString(),
      tenants: tenants.length,
      due: tenants.reduce((sum, item) => sum + Number(item.due || 0), 0),
      sent: tenants.reduce((sum, item) => sum + Number(item.sent || 0), 0),
      whatsappConfigured: Boolean(clean(process.env.WHATSAPP_ACCESS_TOKEN) && clean(process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.MAVIRI_WHATSAPP_TENANTS)),
      results: tenants
    });
  } catch (error) {
    console.error("MAVIRI REMINDERS ERROR:", error);
    return json(res, 500, { ok: false, error: "Errore interno promemoria." });
  }
}
