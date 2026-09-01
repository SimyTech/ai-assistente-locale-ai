import { changeStoredOwnerPassword } from "../lib/account-store.js";
import { ownerAuthorized } from "../lib/auth.js";
import { explicitTenantId, isValidTenantId, normalizeTenantId, resolveTenantId } from "../lib/tenant.js";

const clean = value => String(value ?? "").trim();

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");

  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const requestedTenant = explicitTenantId(req, body);
  if (requestedTenant && !isValidTenantId(requestedTenant)) {
    return res.status(400).json({ ok: false, error: "Identificativo attività non valido." });
  }

  const tenantId = resolveTenantId(req, body);
  if (!ownerAuthorized(req, tenantId)) {
    return res.status(401).json({ ok: false, error: "Sessione non valida o scaduta." });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Metodo non consentito." });
  }

  const action = clean(body.action).toLowerCase();
  if (action !== "change-password") {
    return res.status(400).json({ ok: false, error: "Operazione account non valida." });
  }

  const login = clean(body.login);
  const currentPassword = String(body.currentPassword ?? "");
  const newPassword = String(body.newPassword ?? "");
  if (!login || !currentPassword || !newPassword) {
    return res.status(400).json({ ok: false, error: "Compila tutti i campi password." });
  }

  if (newPassword.length < 10 || newPassword.length > 200) {
    return res.status(400).json({ ok: false, error: "La nuova password deve contenere almeno 10 caratteri." });
  }

  try {
    const result = await changeStoredOwnerPassword({
      login,
      currentPassword,
      newPassword,
      tenantId: normalizeTenantId(tenantId)
    });

    if (result.changed) {
      return res.status(200).json({ ok: true, changed: true });
    }

    if (result.reason === "same-password") {
      return res.status(400).json({ ok: false, error: "Scegli una password diversa da quella attuale." });
    }
    if (result.reason === "invalid-password") {
      return res.status(400).json({ ok: false, error: "La nuova password non rispetta i requisiti." });
    }
    if (result.reason === "tenant-mismatch") {
      return res.status(403).json({ ok: false, error: "L'account non appartiene a questa attività." });
    }

    return res.status(401).json({ ok: false, error: "Password attuale non corretta o account non modificabile." });
  } catch (error) {
    console.error("MAVIRI ACCOUNT ERROR:", error);
    return res.status(503).json({ ok: false, error: "Gestione account temporaneamente non disponibile." });
  }
}
