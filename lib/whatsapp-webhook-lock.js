const clean = value => String(value ?? "").trim();
const LOCK_TTL_MS = 30_000;

const redisUrl = env => clean(env.UPSTASH_REDIS_REST_URL);
const redisToken = env => clean(env.UPSTASH_REDIS_REST_TOKEN);

async function redisCommand(env, command, ...args) {
  if (!redisUrl(env) || !redisToken(env)) throw new Error("Upstash Redis non configurato.");
  const response = await fetch(redisUrl(env), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${redisToken(env)}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify([command, ...args])
  });
  if (!response.ok) throw new Error(`Redis HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(String(payload.error));
  return payload.result;
}

export function extractWhatsAppMessageId(body) {
  for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      for (const message of Array.isArray(change?.value?.messages) ? change.value.messages : []) {
        const id = clean(message?.id);
        if (id) return id;
      }
    }
  }
  return "";
}

export function whatsappWebhookLockKey(tenantId, messageId) {
  return `maviri:whatsapp:inflight:${clean(tenantId)}:${clean(messageId)}`;
}

export async function acquireWhatsAppWebhookLock({ tenantId, messageId }, env = process.env) {
  const id = clean(messageId);
  if (!id) return { acquired: true, key: "" };
  const key = whatsappWebhookLockKey(tenantId, id);
  const result = await redisCommand(env, "SET", key, "1", "NX", "PX", String(LOCK_TTL_MS));
  return { acquired: String(result).toUpperCase() === "OK", key };
}

export async function releaseWhatsAppWebhookLock(key, env = process.env) {
  const value = clean(key);
  if (!value) return;
  await redisCommand(env, "DEL", value);
}
