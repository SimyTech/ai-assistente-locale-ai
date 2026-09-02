function clean(value) {
  return String(value ?? "").trim();
}

export function createProposalUiState(proposal = {}, options = {}) {
  const channelReady = Boolean(options.channelReady);
  return {
    proposal: { ...proposal },
    text: clean(proposal.text),
    approved: false,
    editing: false,
    channelReady,
    sendEnabled: false,
    sentRequested: false
  };
}

export function reduceProposalUi(state, action = {}) {
  const next = { ...state, proposal: { ...(state?.proposal || {}) } };
  switch (action.type) {
    case "approve":
      next.approved = true;
      next.editing = false;
      next.sendEnabled = Boolean(next.channelReady);
      return next;
    case "edit":
      next.editing = true;
      next.approved = false;
      next.sendEnabled = false;
      return next;
    case "change-text":
      next.text = clean(action.text);
      next.proposal.text = next.text;
      next.approved = false;
      next.sendEnabled = false;
      return next;
    case "save-edit":
      next.editing = false;
      next.proposal.text = next.text;
      next.approved = false;
      next.sendEnabled = false;
      return next;
    case "channel-status":
      next.channelReady = Boolean(action.ready);
      next.sendEnabled = next.approved && next.channelReady;
      return next;
    case "request-send":
      if (!next.approved || !next.channelReady) return next;
      next.sentRequested = true;
      next.sendEnabled = false;
      return next;
    default:
      return next;
  }
}

function proposalTitle(proposal) {
  if (proposal?.kind === "message-draft") return proposal.recipientName ? `Messaggio per ${proposal.recipientName}` : "Messaggio cliente";
  if (proposal?.kind === "content-draft") return "Contenuto promozionale";
  if (proposal?.kind === "agenda-opportunity") return "Opportunità agenda";
  return "Proposta Mavi";
}

function proposalText(proposal) {
  if (proposal?.text) return clean(proposal.text);
  if (proposal?.kind === "agenda-opportunity") {
    return `Slot ${clean(proposal.date)} ${clean(proposal.start)}–${clean(proposal.end)}${proposal.recommendedService ? ` · ${clean(proposal.recommendedService)}` : ""}`;
  }
  return "Proposta pronta per la revisione.";
}

function defaultChannelReady(proposal, win) {
  try {
    if (typeof win?.MaviAuthorizedSend?.canSend === "function") return Boolean(win.MaviAuthorizedSend.canSend(proposal));
  } catch {}
  return false;
}

export function installProactiveActionUi(win = globalThis.window, doc = globalThis.document) {
  if (!win || !doc || win.__MAVI_PROACTIVE_ACTION_UI__) return false;

  const style = doc.createElement("style");
  style.textContent = `
    .mavi-action-card{position:fixed;right:18px;bottom:18px;z-index:99999;width:min(390px,calc(100vw - 36px));background:#fff;border:1px solid rgba(15,23,42,.14);border-radius:18px;box-shadow:0 18px 50px rgba(15,23,42,.18);padding:16px;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111827}
    .mavi-action-card h3{margin:0 0 8px;font-size:16px}.mavi-action-card p{margin:0 0 12px;white-space:pre-wrap;line-height:1.45;font-size:14px}.mavi-action-card textarea{width:100%;min-height:110px;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:12px;padding:10px;font:inherit;resize:vertical}.mavi-action-row{display:flex;gap:8px;flex-wrap:wrap}.mavi-action-card button{border:0;border-radius:10px;padding:9px 12px;font-weight:650;cursor:pointer}.mavi-action-card button[disabled]{opacity:.45;cursor:not-allowed}.mavi-action-status{font-size:12px;margin-top:10px;color:#475569}.mavi-action-close{position:absolute;right:10px;top:8px;background:transparent!important;font-size:18px;padding:4px 7px!important}
  `;
  doc.head?.appendChild(style);

  let card = null;
  let state = null;

  function removeCard() {
    card?.remove();
    card = null;
    state = null;
  }

  function render() {
    if (!card || !state) return;
    const body = card.querySelector("[data-mavi-body]");
    const textarea = card.querySelector("textarea");
    const approve = card.querySelector("[data-action=approve]");
    const edit = card.querySelector("[data-action=edit]");
    const save = card.querySelector("[data-action=save]");
    const send = card.querySelector("[data-action=send]");
    const status = card.querySelector("[data-mavi-status]");

    body.hidden = state.editing;
    textarea.hidden = !state.editing;
    save.hidden = !state.editing;
    approve.hidden = state.editing;
    edit.hidden = state.editing;
    send.disabled = !state.sendEnabled;
    send.textContent = state.channelReady ? "Invia" : "Canale non configurato";

    if (state.editing) textarea.value = state.text;
    else body.textContent = state.text || proposalText(state.proposal);

    if (state.sentRequested) status.textContent = "Richiesta di invio inoltrata al canale autorizzato. È ancora necessaria la conferma finale del canale.";
    else if (state.approved && state.channelReady) status.textContent = "Proposta approvata. L'invio richiede ancora il comando finale.";
    else if (state.approved) status.textContent = "Proposta approvata, ma il canale non è configurato.";
    else status.textContent = "Nessuna azione viene eseguita senza approvazione.";
  }

  function open(detail = {}) {
    const proposal = detail.proposal;
    if (!proposal) return;
    removeCard();
    state = createProposalUiState(proposal, { channelReady: defaultChannelReady(proposal, win) });
    state.text = proposalText(proposal);
    state.proposal.text = state.text;

    card = doc.createElement("section");
    card.className = "mavi-action-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "Proposta Mavi da approvare");
    card.innerHTML = `<button class="mavi-action-close" type="button" aria-label="Chiudi">×</button><h3></h3><p data-mavi-body></p><textarea hidden aria-label="Modifica proposta"></textarea><div class="mavi-action-row"><button data-action="approve" type="button">Approva</button><button data-action="edit" type="button">Modifica</button><button data-action="save" type="button" hidden>Salva modifica</button><button data-action="send" type="button" disabled>Invia</button></div><div class="mavi-action-status" data-mavi-status></div>`;
    card.querySelector("h3").textContent = proposalTitle(proposal);
    card.querySelector(".mavi-action-close").addEventListener("click", removeCard);
    card.querySelector("[data-action=approve]").addEventListener("click", () => { state = reduceProposalUi(state, { type: "approve" }); render(); });
    card.querySelector("[data-action=edit]").addEventListener("click", () => { state = reduceProposalUi(state, { type: "edit" }); render(); });
    card.querySelector("[data-action=save]").addEventListener("click", () => {
      state = reduceProposalUi(state, { type: "change-text", text: card.querySelector("textarea").value });
      state = reduceProposalUi(state, { type: "save-edit" });
      render();
      win.dispatchEvent(new CustomEvent("mavi:proactive-action-edited", { detail: { proposal: state.proposal } }));
    });
    card.querySelector("[data-action=send]").addEventListener("click", () => {
      const before = state;
      state = reduceProposalUi(state, { type: "request-send" });
      render();
      if (!before.sentRequested && state.sentRequested) {
        win.dispatchEvent(new CustomEvent("mavi:authorized-send-request", { detail: { proposal: state.proposal, approved: true, execute: false } }));
      }
    });
    doc.body.appendChild(card);
    render();
  }

  win.addEventListener("mavi:proactive-action-proposal", event => open(event.detail));
  win.addEventListener("mavi:channel-status", event => {
    if (!state) return;
    state = reduceProposalUi(state, { type: "channel-status", ready: Boolean(event.detail?.ready) });
    render();
  });
  win.__MAVI_PROACTIVE_ACTION_UI__ = true;
  return true;
}
