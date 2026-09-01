import { ownerAuthorized, ownerTokenForTenant } from "../lib/auth.js";
import { explicitTenantId, isValidTenantId, resolveTenantId } from "../lib/tenant.js";
import { clearSessionCookie, createSession, sessionCookie, sessionSecretForTenant } from "../lib/session.js";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const requestedTenant = explicitTenantId(req, body);
  if (requestedTenant && !isValidTenantId(requestedTenant)) {
    return res.status(400).json({ ok: false, error: "Identificativo attività non valido." });
  }
  const tenantId = resolveTenantId(req, body);

  if (req.method === "GET") {
    return res.status(ownerAuthorized(req, tenantId) ? 200 : 401).json({
      ok: ownerAuthorized(req, tenantId),
      authenticated: ownerAuthorized(req, tenantId),
      tenantId
    });
  }

  if (req.method === "DELETE") {
    res.setHeader("Set-Cookie", clearSessionCookie());
    return res.status(200).json({ ok: true, authenticated: false });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ ok: false, error: "Metodo non consentito." });
  }

  const token = String(body.token || "").trim();
  const syntheticRequest = { headers: { "x-maviri-owner-token": token } };
  if (!ownerAuthorized(syntheticRequest, tenantId)) {
    return res.status(401).json({ ok: false, error: "Credenziali non valide." });
  }

  const tenantToken = ownerTokenForTenant(tenantId);
  const session = createSession({
    tenantId,
    secret: sessionSecretForTenant(tenantId, process.env, tenantToken)
  });
  res.setHeader("Set-Cookie", sessionCookie(session));
  return res.status(200).json({ ok: true, authenticated: true, tenantId });
}
