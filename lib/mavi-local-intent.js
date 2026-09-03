const clean = value => String(value || "").toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s/]/g, " ").replace(/\s+/g, " ").trim();

const WRITE = ["prenota", "fissa", "sposta", "rimanda", "annulla", "cancella", "modifica", "crea", "aggiungi", "elimina", "invia", "manda", "salva", "conferma"];
const VOCABULARY = Object.freeze({
  agenda: ["agenda", "programma", "calendario", "appuntamento", "appuntamenti", "impegno", "impegni", "giornata", "turni", "visite", "prenotazioni", "scadenze", "recap", "riepilogo"],
  services: ["servizio", "servizi", "trattamento", "trattamenti", "prestazione", "prestazioni", "listino", "tariffario", "prezzo", "prezzi", "costo", "costi", "tariffa", "tariffe", "offro", "proponiamo"],
  clients: ["cliente", "clienti", "persona", "persone", "contatto", "contatti", "rubrica", "anagrafica", "paziente", "pazienti", "ospite", "ospiti"],
  promotions: ["promozione", "promozioni", "promo", "offerta", "offerte", "sconto", "sconti", "campagna", "campagne", "iniziativa", "iniziative"],
  hours: ["orario", "orari", "apertura", "aperto", "apriamo", "chiusura", "chiuso", "chiudiamo", "giorni"],
  address: ["indirizzo", "sede", "ubicazione", "posizione", "dove", "trovo", "siamo"],
  contact: ["telefono", "numero", "whatsapp", "contatto", "chiamare", "scrivere"]
});
const QUERY = new Set(["che", "cosa", "quale", "quali", "quanto", "quanti", "quando", "dove", "chi", "dimmi", "mostra", "fammi", "elenca", "vedere", "sapere", "recap", "riepilogo"]);
const TIME = new Set(["oggi", "domani", "dopodomani", "ieri", "lunedi", "martedi", "mercoledi", "giovedi", "venerdi", "sabato", "domenica", "settimana", "mese", "anno", "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"]);

function distanceAtMostOne(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 5) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else { i += 1; j += 1; }
  }
  return edits + Number(i < a.length || j < b.length) <= 1;
}

const matches = (token, word) => token === word || (token.length >= 6 && word.length >= 6 && distanceAtMostOne(token, word));
const containsAny = (tokens, words) => tokens.some(token => words.some(word => matches(token, word)));

export function analyzeLocalIntent(message) {
  const text = clean(message);
  const tokens = text.split(" ").filter(Boolean);
  if (!tokens.length) return { intent: "unknown", confidence: 0, readOnly: true };
  const write = containsAny(tokens, WRITE);
  if (write) return { intent: "write", confidence: 1, readOnly: false };

  const scores = Object.fromEntries(Object.entries(VOCABULARY).map(([intent, words]) => [intent, containsAny(tokens, words) ? 2 : 0]));
  const hasQuery = tokens.some(token => QUERY.has(token));
  const hasTime = tokens.some(token => TIME.has(token)) || /\b\d{1,2}(?:[/. -]\d{1,2})?\b/.test(text);
  if (hasTime) scores.agenda += 2;
  if (hasQuery) for (const key of Object.keys(scores)) if (scores[key]) scores[key] += 1;
  if (/(che si fa|che facciamo|cosa c e da fare|cosa mi aspetta|che abbiamo|come sono messo)/.test(text)) scores.agenda += 4;
  if (/chi.*(?:vedo|vedere|incontro|incontrare)/.test(text)) scores.agenda += 4;
  if (/(dove (siamo|siete)|come (arrivo|raggiungo)|qual e l indirizzo)/.test(text)) scores.address += 4;
  if (/(numero (di )?telefono|come (vi|ti) contatto|contatto dell attivita)/.test(text)) scores.contact += 4;
  if (/(quanto costa|quanto viene|cosa offrite|cosa proponete)/.test(text)) scores.services += 3;
  if (/(quante persone|quanti nominativi|chi ho in rubrica)/.test(text)) scores.clients += 3;

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [intent, score] = ranked[0];
  if (score < 2) return { intent: "unknown", confidence: 0.35, readOnly: true };
  return { intent, confidence: Math.min(0.99, 0.55 + score * 0.08), readOnly: true };
}

export { clean as normalizeLocalText };
