const normalize = value => String(value || "")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9\s]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const OPERATIONAL = /\b(prenot|fissa|prenota|sposta|rimanda|annulla|cancella|modifica|conferma|salva|crea appunt|nuovo appunt|disponibil|libero|slot)\b/;
const LOCAL_INFO = /\b(serviz|trattament|prezz|cost|tariff|promozion|promo|offert|orar|apert|chius|client|appuntament|impegn|programma|chi viene|chi ho)\b/;
const GREETING = /^(ciao|buongiorno|buonasera|salve|hey|ehi|come va|come stai)(\s|$)/;
const CONVERSATIONAL = /\b(consigli|suggerisc|idea|idee|scrivi|riscrivi|spiega|perche|come posso|cosa ne pensi|aiutami|migliora|testo|messaggio|post|caption)\b/;

export const MAVI_ROUTE = Object.freeze({
  LOCAL_DATA: "local-data",
  BUSINESS_ENGINE: "business-engine",
  QWEN: "qwen",
  SERVER: "server"
});

export function classifyMaviIntent(message) {
  const text = normalize(message);
  if (!text) return { route: MAVI_ROUTE.SERVER, intent: "empty", confidence: 1 };

  if (OPERATIONAL.test(text)) {
    return { route: MAVI_ROUTE.BUSINESS_ENGINE, intent: "operational", confidence: 0.98 };
  }

  if (LOCAL_INFO.test(text)) {
    return { route: MAVI_ROUTE.LOCAL_DATA, intent: "local-info", confidence: 0.94 };
  }

  if (GREETING.test(text)) {
    return { route: MAVI_ROUTE.QWEN, intent: "conversation", confidence: 0.92 };
  }

  if (CONVERSATIONAL.test(text) || text.split(" ").length >= 5) {
    return { route: MAVI_ROUTE.QWEN, intent: "conversation", confidence: 0.76 };
  }

  return { route: MAVI_ROUTE.SERVER, intent: "unknown", confidence: 0.45 };
}

export function shouldBypassServer(route) {
  return route === MAVI_ROUTE.LOCAL_DATA || route === MAVI_ROUTE.QWEN;
}
