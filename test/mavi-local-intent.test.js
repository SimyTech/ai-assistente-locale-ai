import test from "node:test";
import assert from "node:assert/strict";
import { analyzeLocalIntent } from "../lib/mavi-local-intent.js";

test("classifica sinonimi e parole fuori ordine", () => {
  const cases = {
    agenda: ["Per lunedì cosa risulta in calendario?", "Il 15 chi devo vedere?", "Riepilogami il mese scorso", "Oggi che si fa?", "In questo mese?", "Questa settimana?", "Quest'anno?"],
    services: ["Cosa proponete?", "Vorrei conoscere il tariffario", "Quanto viene un trattamento?"],
    clients: ["Quanti nominativi risultano?", "Chi ho in rubrica?", "Elenca i pazienti"],
    promotions: ["Avete qualche sconto?", "Quali campagne sono attive?"],
    hours: ["A che ora chiudiamo?", "Quali sono i giorni di apertura?"],
    address: ["Come raggiungo la sede?", "Qual è l'ubicazione?"],
    contact: ["Come vi contatto?", "Qual è il telefono?"]
  };
  for (const [intent, messages] of Object.entries(cases)) {
    for (const message of messages) assert.equal(analyzeLocalIntent(message).intent, intent, message);
  }
});

test("tollera piccoli errori di digitazione", () => {
  assert.equal(analyzeLocalIntent("Mostra gli appuntamnti di domani").intent, "agenda");
  assert.equal(analyzeLocalIntent("Quali promozoni sono attive?").intent, "promotions");
  assert.equal(analyzeLocalIntent("Fammi vedere il listno").intent, "services");
});

test("non trasforma scritture in letture locali", () => {
  for (const message of ["Aggiungi un cliente", "Modifica gli orari", "Cancella l'appuntamento", "Invia la promozione"]) {
    assert.equal(analyzeLocalIntent(message).readOnly, false, message);
  }
});
