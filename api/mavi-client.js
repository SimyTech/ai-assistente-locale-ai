import { verifyMaviEntryToken } from "../lib/mavi-entry-link.js";

const clean = value => String(value ?? "").trim();

function originFor(req) {
  return `${req.headers["x-forwarded-proto"] || "https"}://${req.headers["x-forwarded-host"] || req.headers.host}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Metodo non consentito." });
  }

  const token = clean(req.body?.token || req.headers?.["x-mavi-entry-token"]);
  const verified = verifyMaviEntryToken(token);
  if (!verified.ok) return res.status(401).json({ ok: false, error: verified.error });

  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? { ...req.body }
    : {};
  delete body.token;

  const payload = {
    ...body,
    tenantId: verified.tenantId,
    role: "client",
    mode: "client",
    channel: "mavi-link",
    source: "whatsapp-link",
    clientId: clean(body.clientId) || verified.clientId,
    appointmentId: clean(body.appointmentId) || verified.appointmentId
  };

  try {
    const response = await fetch(`${originFor(req)}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-maviri-tenant": verified.tenantId
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));
    return res.status(response.status).json(data);
  } catch (error) {
    console.error("MAVI CLIENT LINK ERROR:", error);
    return res.status(502).json({ ok: false, error: "Mavi non è raggiungibile in questo momento." });
  }
}
