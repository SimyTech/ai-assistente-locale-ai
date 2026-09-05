export function buildMaviChatUrl(origin, tenantId) {
  const base = String(origin || "").replace(/\/$/, "");
  const tenant = String(tenantId || "").trim();
  if (!base || !tenant) return "";
  return `${base}/mavi/${encodeURIComponent(tenant)}`;
}

export function buildWhatsAppWelcome(origin, tenantId, businessName = "") {
  const url = buildMaviChatUrl(origin, tenantId);
  if (!url) return "";
  const name = String(businessName || "").trim();
  const intro = name ? `Ciao! Benvenuto da ${name}.` : "Ciao! Benvenuto.";
  return `${intro} Per informazioni, disponibilità e prenotazioni entra in Mavi Chat: ${url}`;
}

async function copyText(text, doc) {
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const area = doc.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  doc.body.appendChild(area);
  area.select();
  const copied = doc.execCommand?.("copy") === true;
  area.remove();
  return copied;
}

export function installMaviChatLink(doc = document, root = window) {
  const actions = doc.querySelector(".context-actions");
  if (!actions || doc.getElementById("maviChatCopyLink")) return;

  const tenantId = String(root.localStorage?.getItem("MAVIRI_TENANT_ID") || "").trim();
  const url = buildMaviChatUrl(root.location?.origin, tenantId);
  if (!url) return;

  const open = doc.createElement("a");
  open.id = "maviChatOpenLink";
  open.href = url;
  open.target = "_blank";
  open.rel = "noopener noreferrer";
  open.textContent = "Mavi Chat";
  open.title = "Apri la Mavi Chat pubblica dell'attività";

  const copy = doc.createElement("button");
  copy.id = "maviChatCopyLink";
  copy.type = "button";
  copy.textContent = "Copia link";
  copy.title = url;
  copy.style.cssText = "border:0;background:transparent;color:#9fcfff;padding:0;font:inherit;font-size:12px;cursor:pointer;touch-action:manipulation;white-space:nowrap";

  copy.addEventListener("click", async () => {
    const previous = copy.textContent;
    try {
      const ok = await copyText(url, doc);
      copy.textContent = ok ? "Link copiato" : "Copia non riuscita";
    } catch {
      copy.textContent = "Copia non riuscita";
    }
    root.setTimeout(() => { copy.textContent = previous; }, 1800);
  });

  actions.prepend(copy);
  actions.prepend(open);
}
