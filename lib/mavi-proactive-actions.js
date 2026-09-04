const normalize = value => String(value || "")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9\s]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const ACTION_WORDS = /(ricontatt|contatt|messaggio|scriv|preparam|recuper|riattiv|promozion|promo|buco|slot|fascia|orario|debole)/;
const SEND_WORDS = /^(invia|manda|spedisc|procedi con l invio|approva e invia)$/;

function clean(value) {
  return String(value ?? "").trim();
}

function findClient(data, name) {
  const target = normalize(name);
  if (!target) return null;
  const clients = Array.isArray(data?.clients) ? data.clients : [];
  return clients.find(client => normalize(client?.name) === target)
    || clients.find(client => normalize(client?.name).includes(target) || target.includes(normalize(client?.name)))
    || null;
}

function matchBriefItem(message, brief) {
  const text = normalize(message);
  const items = Array.isArray(brief?.items) ? brief.items : [];
  const named = items.filter(item => item?.name && text.includes(normalize(item.name)));
  if (named.length === 1) return named[0];
  if (/fascia|orario|debole/.test(text)) return items.find(item => item.type === "weak-time-band" && (!item.label || text.includes(normalize(item.label)))) || items.find(item => item.type === "weak-time-band") || null;
  if (/promozion|promo/.test(text)) return items.find(item => item.type === "promotion-expiry") || items.find(item => item.type === "weak-time-band") || null;
  if (/buco|slot/.test(text)) return items.find(item => item.type === "agenda-gap") || null;
  if (/cancell|recuper/.test(text)) return items.find(item => item.type === "cancellation-recovery") || null;
  if (/inattiv|riattiv/.test(text)) return items.find(item => item.type === "inactive-client") || null;
  return items.length === 1 ? items[0] : null;
}

function recontactDraft(item, data) {
  const client = findClient(data, item?.name);
  const name = clean(item?.name || client?.name) || "cliente";
  const service = clean(item?.service);
  const intro = `Ciao ${name}, sono ${clean(data?.business?.name || data?.settings?.name) || "l'attività"}.`;
  let body = "Ti scrivo perché mi farebbe piacere rivederti.";
  if (item?.type === "cancellation-recovery") body = `Ho visto che il tuo ultimo appuntamento${service ? ` per ${service}` : ""} non si è poi svolto. Se vuoi, possiamo trovare un nuovo orario comodo per te.`;
  if (item?.type === "inactive-client") body = `È passato un po' di tempo dall'ultima visita${service ? ` per ${service}` : ""}. Se vuoi, posso proporti qualche disponibilità nei prossimi giorni.`;
  return {
    kind: "message-draft",
    channel: clean(client?.whatsapp || client?.phone) ? "whatsapp" : "unspecified",
    recipientName: name,
    recipient: clean(client?.whatsapp || client?.phone),
    text: `${intro} ${body}`,
    requiresApproval: true,
    executable: false,
    sourceType: item?.type || "proactive"
  };
}

function promotionDraft(item, data) {
  const business = clean(data?.business?.name || data?.settings?.name) || "la nostra attività";
  return {
    kind: "content-draft",
    channel: "social",
    text: `Ultimi giorni per ${clean(item?.name) || "la promozione"} da ${business}. Approfittane prima della scadenza${item?.expiry ? ` del ${item.expiry}` : ""}.`,
    requiresApproval: true,
    executable: false,
    sourceType: "promotion-expiry"
  };
}

function weakBandDraft(item, data) {
  const business = clean(data?.business?.name || data?.settings?.name) || "la nostra attività";
  const band = clean(item?.label) || "questa fascia oraria";
  return {
    kind: "content-draft",
    channel: "social",
    text: `Hai più flessibilità ${band}? Contatta ${business} e scopri le disponibilità più comode per te.`,
    requiresApproval: true,
    executable: false,
    sourceType: "weak-time-band",
    strategy: "improve-demand",
    targetBand: band
  };
}

function gapProposal(item) {
  return {
    kind: "agenda-opportunity",
    date: clean(item?.date),
    start: clean(item?.start),
    end: clean(item?.end),
    recommendedService: clean(item?.recommendedService?.name),
    potentialValue: Number(item?.potentialValue || 0),
    requiresApproval: true,
    executable: false,
    sourceType: "agenda-gap"
  };
}

function proposalFor(item, data) {
  if (!item) return null;
  if (["inactive-client", "cancellation-recovery"].includes(item.type)) return recontactDraft(item, data);
  if (item.type === "promotion-expiry") return promotionDraft(item, data);
  if (item.type === "weak-time-band") return weakBandDraft(item, data);
  if (item.type === "agenda-gap") return gapProposal(item);
  return null;
}

function answerFor(proposal) {
  if (!proposal) return "Non riesco a collegare la richiesta a una segnalazione precisa. Indicami il cliente o la segnalazione.";
  if (proposal.kind === "message-draft") {
    const recipient = proposal.recipientName ? ` per ${proposal.recipientName}` : "";
    return `Ho preparato una bozza${recipient}:\n\n${proposal.text}\n\nNon l'ho inviata. Serve la tua approvazione esplicita prima di qualsiasi invio.`;
  }
  if (proposal.kind === "content-draft") return `Ho preparato questa bozza promozionale:\n\n${proposal.text}\n\nNon è stata pubblicata. Puoi modificarla e serve la tua approvazione prima della pubblicazione.`;
  if (proposal.kind === "agenda-opportunity") {
    const service = proposal.recommendedService ? ` con ${proposal.recommendedService}` : "";
    return `Il buco è ${proposal.date} dalle ${proposal.start} alle ${proposal.end}${service}. Posso preparare un'azione per riempirlo, ma non modifico l'agenda senza approvazione.`;
  }
  return "Proposta pronta. Serve la tua approvazione prima dell'esecuzione.";
}

export function createMaviProactiveActions() {
  const selectedByConversation = new Map();

  function handle(message, brief, data = {}, conversationId = "default") {
    const text = normalize(message);
    const key = String(conversationId || "default").slice(0, 120);

    if (SEND_WORDS.test(text)) {
      const selected = selectedByConversation.get(key);
      if (!selected) return { handled: false };
      return {
        handled: true,
        answer: "La proposta è pronta ma questo livello di Mavi non esegue invii automatici. L'invio deve passare dal canale autorizzato e dalla conferma finale del titolare.",
        proposal: selected,
        approvalRequired: true,
        execute: false
      };
    }

    if (!ACTION_WORDS.test(text)) return { handled: false };

    const item = matchBriefItem(message, brief);
    if (!item) {
      return {
        handled: true,
        answer: "A quale segnalazione ti riferisci? Indicami il cliente, la promozione, la fascia oraria o il buco in agenda.",
        proposal: null,
        approvalRequired: false
      };
    }

    const proposal = proposalFor(item, data);
    if (proposal) selectedByConversation.set(key, proposal);
    return {
      handled: true,
      answer: answerFor(proposal),
      proposal,
      approvalRequired: Boolean(proposal),
      execute: false
    };
  }

  return {
    handle,
    clear(conversationId = "default") {
      selectedByConversation.delete(String(conversationId || "default").slice(0, 120));
    }
  };
}
