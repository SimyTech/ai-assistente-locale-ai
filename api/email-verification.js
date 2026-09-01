import { consumeEmailVerification, requestEmailVerification } from "../lib/email-verification.js";
import { ownerAuthorized } from "../lib/auth.js";
import { resolveTenantId } from "../lib/tenant.js";

const clean = value => String(value ?? "").trim();

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");

  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};

  if (req.method === "PUT") {
    const token = clean(body.token);
    if (!token) return res.status(400).json({ ok: false, error: "Link di verifica non valido." });
    try {
      const result = await consumeEmailVerification(token);
      if (result.verified) return res.status(200).json({ ok: true, verified: true });
      return res.status(400).json({ ok: false, verified: false, error: "Il link è scaduto o non è più valido." });
    } catch (error) {
      console.error("MAVIRI EMAIL VERIFY ERROR:", error);
      return res.status(503).json({ ok: false, error: "Verifica email temporaneamente non disponibile." });
    }
  }

  if (req.method === "POST") {
    const tenantId = resolveTenantId(req, body);
    if (!ownerAuthorized(req, tenantId)) {
      return res.status(401).json({ ok: false, error: "Sessione non valida o scaduta." });
    }
    const email = clean(body.email).toLowerCase();
    if (!email) return res.status(400).json({ ok: false, error: "Email account non disponibile." });
    try {
      const result = await requestEmailVerification(email);
      if (result.reason === "already-verified") return res.status(200).json({ ok: true, sent: false, verified: true });
      if (result.reason === "email-not-configured") {
        return res.status(503).json({ ok: false, error: "Invio email Maviri non ancora configurato." });
      }
      if (!result.accepted) return res.status(400).json({ ok: false, error: "Impossibile inviare la verifica email." });
      return res.status(200).json({ ok: true, sent: result.sent === true, verified: false });
    } catch (error) {
      console.error("MAVIRI EMAIL VERIFY REQUEST ERROR:", error);
      return res.status(503).json({ ok: false, error: "Invio verifica email temporaneamente non disponibile." });
    }
  }

  res.setHeader("Allow", "POST, PUT");
  return res.status(405).json({ ok: false, error: "Metodo non consentito." });
}
