const clean = value => String(value ?? "").trim();

export function publicHttpsUrl(value) {
  const raw = clean(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !url.hostname) return "";
    if (url.username || url.password) return "";
    return url.origin;
  } catch {
    return "";
  }
}

export function validPublicHttpsUrl(value) {
  return Boolean(publicHttpsUrl(value));
}
