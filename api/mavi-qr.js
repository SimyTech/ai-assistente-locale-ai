import QRCode from "qrcode";
import { buildMaviChatUrl } from "../mavi-chat-link.js";

const clean = value => String(value ?? "").trim();

export function publicMaviOrigin(env = process.env) {
  return clean(env.MAVIRI_PUBLIC_ORIGIN || "https://www.maviri.it").replace(/\/+$/, "");
}

export function maviQrTarget(tenantId, env = process.env) {
  return buildMaviChatUrl(publicMaviOrigin(env), tenantId);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  const tenantId = clean(req.query?.tenant);
  if (!tenantId || tenantId.length > 100 || !/^[a-zA-Z0-9_-]+$/.test(tenantId)) {
    return res.status(400).json({ ok: false, error: "Tenant non valido." });
  }

  const target = maviQrTarget(tenantId);
  const svg = await QRCode.toString(target, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 640,
    color: { dark: "#07142F", light: "#FFFFFF" }
  });

  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Content-Disposition", `inline; filename="mavi-${tenantId}.svg"`);
  return res.status(200).send(svg);
}
