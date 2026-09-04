import whatsappHandler from "./whatsapp.js";
import { handleSafeCancellation } from "../lib/whatsapp-cancellation-guard.js";
import { handleSafeReschedule } from "../lib/whatsapp-reschedule-guard.js";
import { whatsappTenantRoute } from "../lib/whatsapp-tenant.js";
import {
  acquireWhatsAppWebhookLock,
  extractWhatsAppMessageId,
  releaseWhatsAppWebhookLock
} from "../lib/whatsapp-webhook-lock.js";
import { parseJsonBody, readRawBody, verifyMetaSignature } from "../lib/webhook-signature.js";

const clean = value => String(value ?? "").trim();

export const config = {
  api: {
    bodyParser: false
  }
};

export default async function handler(req, res) {
  if (req?.method !== "POST") {
    return whatsappHandler(req, res);
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (error) {
    console.error("MAVIRI WHATSAPP RAW BODY ERROR:", error);
    return res.status(400).json({ ok: false, error: "Corpo webhook non leggibile." });
  }

  const suppliedSignature = clean(req.headers?.["x-hub-signature-256"]);

  // Meta's dashboard can emit webhook test payloads without the production
  // X-Hub-Signature-256 header. Acknowledge those probes but never process
  // them, so unsigned traffic cannot reach booking/chat logic.
  if (!suppliedSignature) {
    return res.status(200).json({
      ok: true,
      ignored: true,
      reason: "unsigned-webhook-probe"
    });
  }

  const valid = verifyMetaSignature({
    secret: process.env.WHATSAPP_APP_SECRET,
    signature: suppliedSignature,
    rawBody
  });

  if (!valid) {
    return res.status(401).json({ ok: false, error: "Firma WhatsApp non valida." });
  }

  try {
    req.body = parseJsonBody(rawBody);
  } catch {
    return res.status(400).json({ ok: false, error: "JSON webhook non valido." });
  }

  // Preserve the exact bytes so the existing handler performs the same HMAC check too.
  req.rawBody = rawBody;

  if (!clean(req.headers?.["content-type"])) {
    req.headers = { ...(req.headers || {}), "content-type": "application/json" };
  }

  const route = whatsappTenantRoute(req.body, process.env);
  if (!route.accepted) {
    console.warn("MAVIRI WHATSAPP UNMAPPED ROUTE:", {
      phoneNumberId: route.phoneNumberId || null,
      routeCount: route.routeCount
    });
    return res.status(200).json({
      ok: true,
      ignored: true,
      reason: "unmapped-whatsapp-number"
    });
  }

  const messageId = extractWhatsAppMessageId(req.body);
  let lock = { acquired: true, key: "" };
  try {
    lock = await acquireWhatsAppWebhookLock({ tenantId: route.tenantId, messageId });
  } catch (error) {
    console.error("MAVIRI WHATSAPP LOCK ERROR:", error);
    return res.status(500).json({ ok: false, error: "Errore interno sincronizzazione WhatsApp." });
  }

  if (!lock.acquired) {
    return res.status(200).json({
      ok: true,
      duplicate: true,
      inProgress: true,
      tenantId: route.tenantId,
      messageId: messageId || null
    });
  }

  try {
    return await processVerifiedWebhook(req, res);
  } finally {
    try {
      await releaseWhatsAppWebhookLock(lock);
    } catch (error) {
      console.error("MAVIRI WHATSAPP LOCK RELEASE ERROR:", error);
    }
  }
}

async function processVerifiedWebhook(req, res) {
  try {
    const safeReschedule = await handleSafeReschedule(req, res);
    if (safeReschedule) return safeReschedule;
  } catch (error) {
    console.error("MAVIRI WHATSAPP RESCHEDULE GUARD ERROR:", error);
    return res.status(500).json({ ok: false, error: "Errore interno spostamento WhatsApp." });
  }

  try {
    const safeCancellation = await handleSafeCancellation(req, res);
    if (safeCancellation) return safeCancellation;
  } catch (error) {
    console.error("MAVIRI WHATSAPP CANCELLATION GUARD ERROR:", error);
    return res.status(500).json({ ok: false, error: "Errore interno annullamento WhatsApp." });
  }

  return whatsappHandler(req, res);
}
