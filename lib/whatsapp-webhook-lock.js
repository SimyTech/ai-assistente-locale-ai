import { randomUUID } from "node:crypto";

const clean = value => String(value ?? "").trim();
const LOCK_TTL_MS = 30_000;
const RELEASE_IF_OWNER_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

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
  if (!id) return { acquired: true, key: "", token: "" };
  const key = whatsappWebhookLockKey(tenantId, id);
  const token = randomUUID();
  const result = await redisCommand(env, "SET", key, token, "NX", "PX", String(LOCK_TTL_MS));
  return { acquired: String(result).toUpperCase() === "OK", key, token };
}

export async function releaseWhatsAppWebhookLock(lock, env = process.env) {
  const key = clean(lock?.key);
  const token = clean(lock?.token);
  if (!key || !token) return false;
  const result = await redisCommand(env, "EVAL", RELEASE_IF_OWNER_SCRIPT, "1", key, token);
  return Number(result) === 1;
}
