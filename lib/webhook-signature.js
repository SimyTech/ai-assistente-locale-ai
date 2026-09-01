import { createHmac, timingSafeEqual } from "node:crypto";

const clean = value => String(value ?? "").trim();

export function safeEqualText(left, right) {
  const a = Buffer.from(clean(left));
  const b = Buffer.from(clean(right));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export function verifyMetaSignature({ secret, signature, rawBody }) {
  const key = clean(secret);
  if (!key) return true;

  const supplied = clean(signature);
  if (!supplied.startsWith("sha256=")) return false;
  if (!rawBody) return false;

  const source = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(String(rawBody));

  const expected = `sha256=${createHmac("sha256", key).update(source).digest("hex")}`;
  return safeEqualText(supplied, expected);
}

export async function readRawBody(req) {
  if (req?.rawBody) {
    return Buffer.isBuffer(req.rawBody)
      ? req.rawBody
      : Buffer.from(String(req.rawBody));
  }

  // Test harness / compatibility path. In production the body parser is disabled,
  // so the request remains a readable stream and this branch is not used.
  if (req?.body !== undefined && req?.body !== null) {
    if (Buffer.isBuffer(req.body)) return req.body;
    if (typeof req.body === "string") return Buffer.from(req.body);
    return Buffer.from(JSON.stringify(req.body));
  }

  if (!req || typeof req[Symbol.asyncIterator] !== "function") {
    return Buffer.alloc(0);
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function parseJsonBody(rawBody) {
  if (!rawBody || rawBody.length === 0) return {};
  return JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody));
}
