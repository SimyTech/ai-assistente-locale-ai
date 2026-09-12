const clean = value => String(value ?? "").replace(/\u0000/g, "").trim();

export function normalizeWhatsappRecipient(value) {
  let phone = clean(value).replace(/[^\d+]/g, "");
  if (phone.startsWith("00")) phone = `+${phone.slice(2)}`;
  if (!phone.startsWith("+")) phone = `+${phone}`;
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : "";
}

export function createManualWhatsappProposal(recipient, text) {
  const phone = normalizeWhatsappRecipient(recipient);
  const body = clean(text);
  if (!phone || !body) return null;
  return {
    kind: "message-draft",
    channel: "whatsapp",
    recipient: phone,
    recipientName: phone,
    text: body.slice(0, 4096),
    requiresApproval: true,
    executable: false,
    sourceType: "manual-whatsapp"
  };
}

export function installManualWhatsappUi(win = globalThis.window, doc = globalThis.document) {
  if (!win || !doc || win.__MAVI_MANUAL_WHATSAPP_UI__) return false;

  const style = doc.createElement("style");
  style.textContent = `
    .mavi-whatsapp-modal{position:fixed;inset:0;z-index:99998;display:grid;place-items:center;padding:18px;background:rgba(2,8,23,.78);backdrop-filter:blur(6px)}
    .mavi-whatsapp-panel{width:min(520px,100%);padding:20px;border:1px solid rgba(255,255,255,.12);border-radius:20px;background:#0b1d40;color:#f6f8ff;box-shadow:0 24px 70px rgba(0,0,0,.45)}
    .mavi-whatsapp-panel h3{margin:0 0 6px}.mavi-whatsapp-panel p{margin:0 0 16px;color:#aebddb;font-size:13px;line-height:1.45}
    .mavi-whatsapp-panel label{display:grid;gap:6px;margin-top:12px;color:#c7d2ea;font-size:13px}.mavi-whatsapp-panel input,.mavi-whatsapp-panel textarea{width:100%;box-sizing:border-box;border:1px solid rgba(255,255,255,.12);border-radius:12px;background:#071a38;color:#fff;padding:12px;font:inherit}.mavi-whatsapp-panel textarea{min-height:130px;resize:vertical}
    .mavi-whatsapp-error{min-height:20px;margin-top:8px;color:#ff9aa8;font-size:12px}.mavi-whatsapp-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}.mavi-whatsapp-actions button{min-height:42px;border:1px solid rgba(255,255,255,.12);border-radius:11px;padding:9px 13px;background:#173764;color:#fff;font-weight:700}.mavi-whatsapp-actions .primary{border:0;background:linear-gradient(135deg,#38a7ff,#875cff 52%,#39d98a)}
  `;
  doc.head?.appendChild(style);

  function open() {
    doc.querySelector(".mavi-whatsapp-modal")?.remove();
    const modal = doc.createElement("section");
    modal.className = "mavi-whatsapp-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Nuovo messaggio WhatsApp");
    modal.innerHTML = `<div class="mavi-whatsapp-panel"><h3>Invia messaggio WhatsApp</h3><p>Inserisci numero e testo. Prima dell'invio vedrai una seconda conferma.</p><label>Numero WhatsApp<input type="tel" autocomplete="tel" inputmode="tel" placeholder="+39 333 123 4567" aria-label="Numero WhatsApp"></label><label>Messaggio<textarea maxlength="4096" aria-label="Messaggio WhatsApp"></textarea></label><div class="mavi-whatsapp-error" aria-live="polite"></div><div class="mavi-whatsapp-actions"><button type="button" data-wa-close>Annulla</button><button type="button" class="primary" data-wa-review>Controlla messaggio</button></div></div>`;
    const close = () => modal.remove();
    modal.querySelector("[data-wa-close]").addEventListener("click", close);
    modal.addEventListener("click", event => { if (event.target === modal) close(); });
    modal.querySelector("[data-wa-review]").addEventListener("click", () => {
      const proposal = createManualWhatsappProposal(
        modal.querySelector('input[aria-label="Numero WhatsApp"]').value,
        modal.querySelector('textarea[aria-label="Messaggio WhatsApp"]').value
      );
      if (!proposal) {
        modal.querySelector(".mavi-whatsapp-error").textContent = "Inserisci un numero internazionale valido e un messaggio.";
        return;
      }
      close();
      win.dispatchEvent(new CustomEvent("mavi:proactive-action-proposal", { detail: { proposal, approvalRequired: true, execute: false } }));
      if (typeof win.MaviAuthorizedSend?.refresh === "function") win.MaviAuthorizedSend.refresh(proposal);
    });
    doc.body.appendChild(modal);
    modal.querySelector('input[aria-label="Numero WhatsApp"]').focus();
  }

  function addButton() {
    const prompts = doc.querySelector("#mavi .quick-prompts");
    if (!prompts || doc.getElementById("mavi-manual-whatsapp")) return false;
    const button = doc.createElement("button");
    button.id = "mavi-manual-whatsapp";
    button.type = "button";
    button.className = "prompt-chip";
    button.textContent = "💬 Invia WhatsApp";
    button.addEventListener("click", open);
    prompts.appendChild(button);
    return true;
  }

  if (!addButton()) setTimeout(addButton, 0);
  win.__MAVI_MANUAL_WHATSAPP_UI__ = true;
  return true;
}
