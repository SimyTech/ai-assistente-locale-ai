import { createHmac, timingSafeEqual } from "node:crypto";

const clean = value => String(value ?? "").trim();

export function safeEqualText(left, right) {
  const a = Buffer.from(clean(left));
  const b = Buffer.from(clean(right));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export function verifyMetaSignature({ secret, signature, rawBody }) {
  const key = clean(secret);
  // Webhook POSTs must never be accepted without the Meta App Secret. GET
  // verification uses the verify token and does not pass through this helper.
  if (!key) return false;

  const supplied = clean(signature);
  if (!supplied.startsWith("sha256=")) return false;
  if (!rawBody) return false;

  const source = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(String(rawBody));

  const expected = `sha256=${createHmac("sha256", key).update(source).digest("hex")}`;
  return safeEqualText(supplied, expected);
}

export function metaSignatureState({ secret, signature, rawBody }) {
  const supplied = clean(signature);
  if (!supplied) return "missing";
  return verifyMetaSignature({ secret, signature: supplied, rawBody }) ? "valid" : "invalid";
}

export async function readRawBody(req) {
  if (req?.rawBody) {
    return Buffer.isBuffer(req.rawBody)
      ? req.rawBody
      : Buffer.from(String(req.rawBody));
  }

  // Signature verification must use the exact bytes received from Meta. Some
  // Vercel request objects can expose a parsed req.body while the underlying
  // stream is still available. Re-serializing that object can change spacing,
  // escaping or property representation and therefore invalidate the HMAC.
  // Always prefer the untouched request stream when it is readable.
  if (req && typeof req[Symbol.asyncIterator] === "function") {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    if (chunks.length > 0) {
      return Buffer.concat(chunks);
    }
  }

  // Compatibility path for tests or runtimes where only a body value exists.
  if (req?.body !== undefined && req?.body !== null) {
    if (Buffer.isBuffer(req.body)) return req.body;
    if (typeof req.body === "string") return Buffer.from(req.body);
    return Buffer.from(JSON.stringify(req.body));
  }

  return Buffer.alloc(0);
}

export function parseJsonBody(rawBody) {
  if (!rawBody || rawBody.length === 0) return {};
  return JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody));
}
