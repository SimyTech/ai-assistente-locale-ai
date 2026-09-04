import { prepareOwnerApprovedCustomerMessage } from "./mavi-customer-message-policy.js";

const DAY_MS = 86400000;
const normalize = value => String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const clean = value => String(value ?? "").trim();
const ACTION_WORDS = /(ricontatt|contatt|messaggio|scriv|preparam|recuper|riattiv|promozion|promo|buco|slot|fascia|orario|debole|whatsapp|pubblico)/;
const SEND_WORDS = /^(invia|manda|spedisc|procedi con l invio|approva e invia)$/;

function findClient(data, name) {
  const target = normalize(name);
  if (!target) return null;
  const clients = Array.isArray(data?.clients) ? data.clients : [];
  return clients.find(client => normalize(client?.name) === target)
    || clients.find(client => normalize(client?.name).includes(target) || target.includes(normalize(client?.name)))
    || null;
}

function completed(item) {
  return ["completed", "completato", "completata", "done"].includes(normalize(item?.status));
}

function activeAppointment(item) {
  return !["cancelled", "canceled", "annullato", "annullata", "deleted"].includes(normalize(item?.status));
}

function dateOnly(value) {
  const text = clean(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function appointmentDate(item) {
  return dateOnly(item?.date || item?.day || item?.start || item?.startsAt);
}

function daysBetween(from, to) {
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${to}T12:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.round((b - a) / DAY_MS)) : 0;
}

function servicePrice(item, data) {
  const direct = Number(item?.price ?? item?.amount);
  if (Number.isFinite(direct) && direct >= 0) return direct;
  const wanted = normalize(item?.service || item?.serviceName);
  const service = (Array.isArray(data?.services) ? data.services : []).find(row => normalize(row?.name) === wanted);
  const price = Number(service?.price ?? service?.amount);
  return Number.isFinite(price) && price >= 0 ? price : 0;
}

function serviceReferenceValue(service, data = {}) {
  const wanted = normalize(service);
  if (!wanted) return { valuePerRecoveredBooking: 0, completedSample: 0, basis: "historical-average-completed", forecast: false };
  const values = (Array.isArray(data?.appointments) ? data.appointments : [])
    .filter(item => completed(item) && normalize(item?.service || item?.serviceName) === wanted)
    .map(item => servicePrice(item, data))
    .filter(value => Number.isFinite(value) && value > 0);
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  return {
    valuePerRecoveredBooking: Math.round(average * 100) / 100,
    completedSample: values.length,
    basis: "historical-average-completed",
    forecast: false
  };
}

function bestServiceForDemand(data = {}) {
  const scores = new Map();
  for (const item of Array.isArray(data?.appointments) ? data.appointments : []) {
    if (!completed(item)) continue;
    const name = clean(item?.service || item?.serviceName);
    if (!name) continue;
    const key = normalize(name);
    const current = scores.get(key) || { name, count: 0, value: 0 };
    current.count += 1;
    current.value += servicePrice(item, data);
    scores.set(key, current);
  }
  return [...scores.values()].sort((a, b) => b.value - a.value || b.count - a.count || a.name.localeCompare(b.name))[0] || null;
}

function resolveClient(item, clients) {
  return clients.find(row => clean(row?.id) && clean(row.id) === clean(item?.clientId))
    || clients.find(row => normalize(row?.name) === normalize(item?.client || item?.clientName || item?.name))
    || null;
}

function clientIdentity(client, fallbackName = "") {
  return clean(client?.id) || normalize(client?.whatsapp || client?.phone) || normalize(client?.name || fallbackName);
}

function recentlyContacted(client, today, days = 30) {
  const contacted = Date.parse(client?.recoveryContactedAt || client?.rebookingContactedAt || "");
  if (!Number.isFinite(contacted)) return false;
  const cutoff = Date.parse(`${today}T00:00:00Z`) - days * DAY_MS;
  return contacted >= cutoff;
}

function clientsForService(service, data = {}) {
  if (!service) return [];
  const wanted = normalize(service);
  const clients = Array.isArray(data?.clients) ? data.clients : [];
  const appointments = Array.isArray(data?.appointments) ? data.appointments : [];
  const today = dateOnly(data?.now || new Date());
  const stats = new Map();

  for (const item of appointments) {
    if (!completed(item) || normalize(item?.service || item?.serviceName) !== wanted) continue;
    const client = resolveClient(item, clients);
    const name = clean(client?.name || item?.client || item?.clientName || item?.name);
    if (!name) continue;
    const key = clientIdentity(client, name);
    if (!key) continue;
    const current = stats.get(key) || { client: client || { name }, name, count: 0, lastVisit: "" };
    current.count += 1;
    const visit = appointmentDate(item);
    if (visit && (!current.lastVisit || visit > current.lastVisit)) current.lastVisit = visit;
    stats.set(key, current);
  }

  return [...stats.entries()].flatMap(([key, row]) => {
    const client = row.client;
    if (recentlyContacted(client, today)) return [];
    const hasUpcoming = appointments.some(item => {
      if (!activeAppointment(item) || completed(item)) return false;
      const date = appointmentDate(item);
      if (!date || date < today) return false;
      const resolved = resolveClient(item, clients);
      return clientIdentity(resolved, item?.client || item?.clientName || item?.name) === key;
    });
    if (hasUpcoming) return [];
    const inactiveDays = row.lastVisit ? daysBetween(row.lastVisit, today) : 0;
    const score = inactiveDays * 10 + row.count;
    return [{ ...client, name: row.name, audienceScore: score, inactiveDays, serviceVisits: row.count, lastServiceVisit: row.lastVisit }];
  }).sort((a, b) => b.audienceScore - a.audienceScore || b.serviceVisits - a.serviceVisits || clean(a.name).localeCompare(clean(b.name))).slice(0, 5);
}

function audienceForService(service, data = {}) {
  return clientsForService(service, data).map(client => clean(client?.name)).filter(Boolean);
}

function whatsappDraftsForService(service, band, data = {}) {
  return clientsForService(service, data).map(client => {
    const prepared = prepareOwnerApprovedCustomerMessage({ kind: "smart_recall", client, context: { service, preferredBand: band } });
    return {
      kind: "message-draft", channel: prepared.channel, recipientName: prepared.clientName, recipient: prepared.phone,
      text: prepared.message, messageMode: prepared.messageMode, approved: prepared.approved,
      requiresApproval: prepared.requiresOwnerApproval, executable: false, sourceType: "weak-time-band",
      strategy: "targeted-recontact", targetBand: band, recommendedService: service,
      audienceScore: client.audienceScore, inactiveDays: client.inactiveDays, serviceVisits: client.serviceVisits, lastServiceVisit: client.lastServiceVisit
    };
  }).filter(draft => draft.recipient);
}

function matchBriefItem(message, brief) {
  const text = normalize(message);
  const items = Array.isArray(brief?.items) ? brief.items : [];
  const named = items.filter(item => item?.name && text.includes(normalize(item.name)));
  if (named.length === 1) return named[0];
  if (/fascia|orario|debole|pubblico|whatsapp/.test(text)) return items.find(item => item.type === "weak-time-band" && (!item.label || text.includes(normalize(item.label)))) || items.find(item => item.type === "weak-time-band") || null;
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
  return { kind:"message-draft", channel:clean(client?.whatsapp || client?.phone) ? "whatsapp" : "unspecified", recipientName:name, recipient:clean(client?.whatsapp || client?.phone), text:`${intro} ${body}`, requiresApproval:true, executable:false, sourceType:item?.type || "proactive" };
}

function promotionDraft(item, data) {
  const business = clean(data?.business?.name || data?.settings?.name) || "la nostra attività";
  return { kind:"content-draft", channel:"social", text:`Ultimi giorni per ${clean(item?.name) || "la promozione"} da ${business}. Approfittane prima della scadenza${item?.expiry ? ` del ${item.expiry}` : ""}.`, requiresApproval:true, executable:false, sourceType:"promotion-expiry" };
}

function weakBandDraft(item, data) {
  const business = clean(data?.business?.name || data?.settings?.name) || "la nostra attività";
  const band = clean(item?.label) || "questa fascia oraria";
  const best = bestServiceForDemand(data);
  const service = clean(best?.name);
  const audience = clientsForService(service, data);
  const suggestedAudience = audience.map(client => clean(client?.name)).filter(Boolean);
  const whatsappDrafts = whatsappDraftsForService(service, band, data);
  const recoveryValueContext = serviceReferenceValue(service, data);
  const serviceText = service ? ` Per questa fascia punterei su ${service}, che nello storico è tra i servizi con maggior valore completato.` : "";
  return {
    kind: "content-draft", channel: "social",
    text: `Hai più flessibilità ${band}? Contatta ${business} e scopri le disponibilità più comode per te.${serviceText}`,
    requiresApproval: true, executable: false, sourceType: "weak-time-band", strategy: "improve-demand", targetBand: band,
    recommendedService: service, recommendedServiceCompleted: Number(best?.count || 0), recommendedServiceValue: Number(best?.value || 0),
    recoveryValueContext,
    suggestedAudience, audienceDetails: audience.map(client => ({ name: clean(client?.name), inactiveDays: client.inactiveDays, serviceVisits: client.serviceVisits, lastServiceVisit: client.lastServiceVisit, score: client.audienceScore })),
    audienceRequiresApproval: true, whatsappDrafts, whatsappRequiresApproval: true
  };
}

function gapProposal(item) {
  return { kind:"agenda-opportunity", date:clean(item?.date), start:clean(item?.start), end:clean(item?.end), recommendedService:clean(item?.recommendedService?.name), potentialValue:Number(item?.potentialValue || 0), requiresApproval:true, executable:false, sourceType:"agenda-gap" };
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
  if (proposal.kind === "message-draft") return `Ho preparato una bozza${proposal.recipientName ? ` per ${proposal.recipientName}` : ""}:\n\n${proposal.text}\n\nNon l'ho inviata. Serve la tua approvazione esplicita prima di qualsiasi invio.`;
  if (proposal.kind === "content-draft") {
    const value = Number(proposal?.recoveryValueContext?.valuePerRecoveredBooking || 0);
    const valueContext = proposal.sourceType === "weak-time-band" && value > 0
      ? ` Valore storico medio di una prenotazione completata del servizio: €${value.toFixed(2)} su ${proposal.recoveryValueContext.completedSample} prestazioni; è un riferimento storico, non una previsione.`
      : "";
    const strategy = proposal.sourceType === "weak-time-band" && proposal.recommendedService
      ? `\n\nStrategia suggerita: ${proposal.recommendedService}${proposal.suggestedAudience?.length ? `; pubblico iniziale: ${proposal.suggestedAudience.join(", ")}` : ""}${proposal.whatsappDrafts?.length ? `; bozze WhatsApp pronte: ${proposal.whatsappDrafts.length}` : ""}.${valueContext}`
      : "";
    return `Ho preparato questa bozza promozionale:\n\n${proposal.text}${strategy}\n\nNon è stata pubblicata. Puoi modificarla e serve la tua approvazione prima della pubblicazione o di qualsiasi ricontatto.`;
  }
  if (proposal.kind === "agenda-opportunity") return `Il buco è ${proposal.date} dalle ${proposal.start} alle ${proposal.end}${proposal.recommendedService ? ` con ${proposal.recommendedService}` : ""}. Posso preparare un'azione per riempirlo, ma non modifico l'agenda senza approvazione.`;
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
      return { handled:true, answer:"La proposta è pronta ma questo livello di Mavi non esegue invii automatici. L'invio deve passare dal canale autorizzato e dalla conferma finale del titolare.", proposal:selected, approvalRequired:true, execute:false };
    }
    if (!ACTION_WORDS.test(text)) return { handled: false };
    const item = matchBriefItem(message, brief);
    if (!item) return { handled:true, answer:"A quale segnalazione ti riferisci? Indicami il cliente, la promozione, la fascia oraria o il buco in agenda.", proposal:null, approvalRequired:false };
    const proposal = proposalFor(item, data);
    if (proposal) selectedByConversation.set(key, proposal);
    return { handled:true, answer:answerFor(proposal), proposal, approvalRequired:Boolean(proposal), execute:false };
  }
  return { handle, clear(conversationId = "default") { selectedByConversation.delete(String(conversationId || "default").slice(0, 120)); } };
}
