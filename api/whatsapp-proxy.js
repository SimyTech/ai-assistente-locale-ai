import whatsappHandler from "./whatsapp.js";
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

  const valid = verifyMetaSignature({
    secret: process.env.WHATSAPP_APP_SECRET,
    signature: req.headers?.["x-hub-signature-256"],
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

  return whatsappHandler(req, res);
}
