import webpush from "web-push";

const clean = value => String(value ?? "").trim();
const redisUrl = env => clean(env.UPSTASH_REDIS_REST_URL);
const redisToken = env => clean(env.UPSTASH_REDIS_REST_TOKEN);
const vapidPublicKey = env => clean(env.MAVIRI_VAPID_PUBLIC_KEY);
const vapidPrivateKey = env => clean(env.MAVIRI_VAPID_PRIVATE_KEY);

function configured(env = process.env) {
  return Boolean(redisUrl(env) && redisToken(env) && vapidPublicKey(env) && vapidPrivateKey(env));
}

function key(tenantId) { return `maviri:push:${clean(tenantId).toLowerCase()}`; }

async function redis(env, command, ...args) {
  const response = await fetch(redisUrl(env), {
    method: "POST",
    headers: { Authorization: `Bearer ${redisToken(env)}`, "Content-Type": "application/json" },
    body: JSON.stringify([command, ...args])
  });
  if (!response.ok) throw new Error(`Redis HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(String(payload.error));
  return payload.result;
}

function validSubscription(value) {
  return value && typeof value === "object" && typeof value.endpoint === "string" && value.endpoint.startsWith("https://") && value.keys && typeof value.keys.p256dh === "string" && typeof value.keys.auth === "string";
}

export function pushNotificationsConfigured(env = process.env) { return configured(env); }
export function pushPublicKey(env = process.env) { return vapidPublicKey(env); }

export async function savePushSubscription({ tenantId, subscription }, env = process.env) {
  if (!configured(env)) return { saved: false, reason: "push-not-configured" };
  if (!validSubscription(subscription)) return { saved: false, reason: "invalid-subscription" };
  const raw = await redis(env, "GET", key(tenantId));
  let current = [];
  try { const parsed = JSON.parse(raw || "[]"); current = Array.isArray(parsed) ? parsed : []; } catch {}
  const next = [...current.filter(item => item?.endpoint !== subscription.endpoint), subscription].slice(-10);
  await redis(env, "SET", key(tenantId), JSON.stringify(next));
  return { saved: true };
}

export async function sendBookingPush({ tenantId, title, body, appointmentId = "" }, env = process.env) {
  if (!configured(env)) return { sent: false, reason: "push-not-configured" };
  const raw = await redis(env, "GET", key(tenantId));
  let subscriptions = [];
  try { const parsed = JSON.parse(raw || "[]"); subscriptions = Array.isArray(parsed) ? parsed : []; } catch {}
  if (!subscriptions.length) return { sent: false, reason: "no-subscriptions" };
  webpush.setVapidDetails("mailto:maviri.app@gmail.com", vapidPublicKey(env), vapidPrivateKey(env));
  const payload = JSON.stringify({ title: clean(title) || "Maviri", body: clean(body), url: "/app", appointmentId: clean(appointmentId) });
  const alive = [];
  let delivered = 0;
  await Promise.all(subscriptions.map(async subscription => {
    try { await webpush.sendNotification(subscription, payload, { TTL: 300 }); alive.push(subscription); delivered += 1; }
    catch (error) { if (![404, 410].includes(Number(error?.statusCode))) alive.push(subscription); }
  }));
  await redis(env, "SET", key(tenantId), JSON.stringify(alive));
  return { sent: delivered > 0, delivered };
}
