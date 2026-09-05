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

function actionButton(doc, id, label, title) {
  const button = doc.createElement("button");
  button.id = id;
  button.type = "button";
  button.textContent = label;
  button.title = title;
  button.style.cssText = "border:0;background:transparent;color:#9fcfff;padding:0;font:inherit;font-size:12px;cursor:pointer;touch-action:manipulation;white-space:nowrap";
  return button;
}

async function copyWithFeedback(button, text, doc, root, successLabel) {
  const previous = button.textContent;
  try {
    const ok = await copyText(text, doc);
    button.textContent = ok ? successLabel : "Copia non riuscita";
  } catch {
    button.textContent = "Copia non riuscita";
  }
  root.setTimeout(() => { button.textContent = previous; }, 1800);
}

export function installMaviChatLink(doc = document, root = window) {
  const actions = doc.querySelector(".context-actions");
  if (!actions || doc.getElementById("maviChatCopyLink")) return;

  const tenantId = String(root.localStorage?.getItem("MAVIRI_TENANT_ID") || "").trim();
  const url = buildMaviChatUrl(root.location?.origin, tenantId);
  if (!url) return;

  const copy = actionButton(doc, "maviChatCopyLink", "Copia link", url);
  copy.addEventListener("click", () => copyWithFeedback(copy, url, doc, root, "Link copiato"));

  const whatsapp = actionButton(
    doc,
    "maviChatCopyWhatsApp",
    "Messaggio WhatsApp",
    "Copia il messaggio di benvenuto da inserire nella risposta automatica WhatsApp Business"
  );
  whatsapp.addEventListener("click", () => {
    const currentName = String(doc.getElementById("activityName")?.textContent || "").trim();
    const businessName = currentName && currentName !== "Maviri" ? currentName : "";
    const message = buildWhatsAppWelcome(root.location?.origin, tenantId, businessName);
    return copyWithFeedback(whatsapp, message, doc, root, "Messaggio copiato");
  });

  actions.prepend(whatsapp);
  actions.prepend(copy);
}
