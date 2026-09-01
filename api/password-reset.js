import { consumePasswordReset, requestPasswordReset } from "../lib/account-recovery.js";

const clean = value => String(value ?? "").trim();

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");

  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};

  if (req.method === "POST") {
    const email = clean(body.email).toLowerCase();
    if (!email) return res.status(400).json({ ok: false, error: "Inserisci la tua email." });

    try {
      const result = await requestPasswordReset(email);
      if (result.reason === "email-not-configured") {
        return res.status(503).json({ ok: false, error: "Recupero password non ancora configurato." });
      }
      return res.status(200).json({
        ok: true,
        message: "Se esiste un account associato a questa email, riceverai un link per reimpostare la password."
      });
    } catch (error) {
      console.error("MAVIRI PASSWORD RESET REQUEST ERROR:", error);
      return res.status(503).json({ ok: false, error: "Recupero password temporaneamente non disponibile." });
    }
  }

  if (req.method === "PUT") {
    const token = clean(body.token);
    const newPassword = String(body.newPassword ?? "");
    if (!token || newPassword.length < 10 || newPassword.length > 200) {
      return res.status(400).json({ ok: false, error: "Link non valido o nuova password non valida." });
    }

    try {
      const result = await consumePasswordReset({ token, newPassword });
      if (result.changed) return res.status(200).json({ ok: true, changed: true });
      if (result.reason === "same-password") {
        return res.status(400).json({ ok: false, error: "Scegli una password diversa da quella precedente." });
      }
      return res.status(400).json({ ok: false, error: "Il link è scaduto o non è più valido." });
    } catch (error) {
      console.error("MAVIRI PASSWORD RESET ERROR:", error);
      return res.status(503).json({ ok: false, error: "Reimpostazione password temporaneamente non disponibile." });
    }
  }

  res.setHeader("Allow", "POST, PUT");
  return res.status(405).json({ ok: false, error: "Metodo non consentito." });
}
