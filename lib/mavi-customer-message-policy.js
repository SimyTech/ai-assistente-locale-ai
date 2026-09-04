const clean = value => String(value ?? "").trim();

export const MAVI_CUSTOMER_MESSAGE_POLICY = Object.freeze({
  tone: ["positive", "cordial", "empathetic", "natural", "non_pushy"],
  ownerApprovalRequired: true,
  ownerModes: ["mavi_generated", "owner_edited", "owner_written"],
  forbiddenFraming: ["guilt", "pressure", "surveillance", "blame"]
});

const firstName = client => clean(client?.name || client?.firstName).split(/\s+/)[0] || "";
const hello = client => firstName(client) ? `Ciao ${firstName(client)},` : "Ciao,";
const availability = context => clean(context?.availability || context?.suggestedSlot);
const service = context => clean(context?.service);
const preferredBand = context => clean(context?.preferredBand || context?.targetBand);

export function buildMaviCustomerMessage(kind, client = {}, context = {}) {
  const greeting = hello(client);
  const slot = availability(context);
  const serviceName = service(context);
  const band = preferredBand(context);
  const close = slot
    ? `Se ti fa piacere, abbiamo disponibilità ${slot}. Se preferisci un altro momento, troviamo volentieri l'orario più comodo per te.`
    : band
      ? `Se la fascia ${band} ti è comoda, possiamo cercare insieme una disponibilità adatta. Se preferisci un altro momento, troviamo volentieri l'orario più comodo per te.`
      : "Se ti fa piacere, possiamo trovare insieme il momento più comodo per te.";

  if (kind === "smart_recall") {
    return `${greeting} come stai? Speriamo tutto bene. ${serviceName ? `Se ti va, potrebbe essere un buon momento per il tuo prossimo ${serviceName}. ` : ""}${close}`;
  }
  if (kind === "inactive_recovery") {
    return `${greeting} come stai? È da un po' che non ci vediamo e ci farebbe piacere rivederti. ${close}`;
  }
  if (kind === "cancellation_recovery") {
    return `${greeting} speriamo vada tutto bene. Se vuoi recuperare l'appuntamento che non siamo riusciti a fare, ${slot ? `abbiamo disponibilità ${slot}. ` : "possiamo cercare una nuova disponibilità. "}Scegli pure il momento che ti è più comodo.`;
  }
  if (kind === "no_show_recovery") {
    return `${greeting} speriamo sia tutto a posto. Se ti fa piacere riprogrammare il tuo appuntamento, siamo qui volentieri. ${close}`;
  }
  return `${greeting} come stai? ${close}`;
}

export function prepareOwnerApprovedCustomerMessage({ kind, client, context, mode = "mavi_generated", text = "" } = {}) {
  if (!MAVI_CUSTOMER_MESSAGE_POLICY.ownerModes.includes(mode)) throw new Error("unsupported-message-mode");
  const ownerText = clean(text);
  const message = mode === "mavi_generated" ? buildMaviCustomerMessage(kind, client, context) : ownerText;
  if (!message) throw new Error("message-required");
  return {
    kind: clean(kind) || "customer_contact",
    clientId: clean(client?.id),
    clientName: clean(client?.name),
    phone: clean(client?.whatsapp || client?.phone),
    message,
    messageMode: mode,
    approved: false,
    requiresOwnerApproval: true,
    channel: "whatsapp"
  };
}
