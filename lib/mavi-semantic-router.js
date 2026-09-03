import { analyzeLocalIntent } from "./mavi-local-intent.js";

const normalize = value => String(value || "")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9\s]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const OPERATIONAL = /(prenot|\bfissa\b|sposta|rimanda|annulla|cancella|modifica|conferma|salva|crea appunt|nuovo appunt|disponibil|\bliber[oaie]?\b|\bslot\b)/;
const LOCAL_INFO = /(serviz|trattament|prezz|cost|tariff|listino|promozion|\bpromo\b|offert|scont|orar|apert|chius|client|contatt|rubrica|appuntament|impegn|programma|agenda|giornata|recap|riepilog|chi viene|chi vedo|chi ho|come sono messo|(?:ho|devo).*(?:fare|gestire)|(?:cosa|che) (?:faccio|si fa|facciamo|c e|mi aspetta|ci aspetta|abbiamo)|(?:oggi|domani|dopodomani|ieri|settimana|mese).*(?:situazione|come va)|indirizzo|dove siamo|numero di telefono)/;
const GREETING = /^(ciao|buongiorno|buonasera|salve|hey|ehi|come va|come stai)(\s|$)/;
const CONVERSATIONAL = /(consigli|suggerisc|\bidea\b|\bidee\b|scrivi|riscrivi|spiega|perche|come posso|cosa ne pensi|aiutami|migliora|\btesto\b|messaggio|\bpost\b|caption)/;

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

  if (GREETING.test(text)) {
    return { route: MAVI_ROUTE.QWEN, intent: "conversation", confidence: 0.92 };
  }

  if (CONVERSATIONAL.test(text)) {
    return { route: MAVI_ROUTE.QWEN, intent: "conversation", confidence: 0.9 };
  }

  const localIntent = analyzeLocalIntent(message);
  if (localIntent.readOnly && localIntent.intent !== "unknown") {
    return { route: MAVI_ROUTE.LOCAL_DATA, intent: localIntent.intent, confidence: localIntent.confidence };
  }

  if (LOCAL_INFO.test(text)) {
    return { route: MAVI_ROUTE.LOCAL_DATA, intent: "local-info", confidence: 0.94 };
  }

  if (text.split(" ").length >= 5) {
    return { route: MAVI_ROUTE.QWEN, intent: "conversation", confidence: 0.7 };
  }

  return { route: MAVI_ROUTE.SERVER, intent: "unknown", confidence: 0.45 };
}

export function shouldBypassServer(route) {
  return route === MAVI_ROUTE.LOCAL_DATA || route === MAVI_ROUTE.QWEN;
}
