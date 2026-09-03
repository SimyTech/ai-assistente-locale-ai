import test from "node:test";
import assert from "node:assert/strict";
import { classifyMaviIntent, MAVI_ROUTE, shouldBypassServer } from "../lib/mavi-semantic-router.js";

test("manda sempre le azioni operative al Business Engine", () => {
  for (const message of [
    "Prenota un taglio domani alle 15",
    "Prenota domani alle 15",
    "Sposta l'appuntamento di Mario",
    "Sposta l'appuntamento",
    "Cancella la prenotazione",
    "Che disponibilità ho domani?"
  ]) {
    assert.equal(classifyMaviIntent(message).route, MAVI_ROUTE.BUSINESS_ENGINE);
  }
});

test("risolve i fatti locali senza rete quando possibile", () => {
  for (const message of [
    "Quanto costa il taglio?",
    "Quali servizi ho?",
    "Che promozioni ci sono?",
    "Quanti clienti ho?",
    "Che appuntamenti ho oggi?",
    "Cosa ho da fare oggi?",
    "Dimmi cosa ho oggi da fare",
    "Dimmi il programma di oggi",
    "Come sono messo oggi?",
    "Chi vedo oggi?",
    "Oggi che si fa?",
    "Cosa c'è da fare oggi?",
    "Oggi cosa mi aspetta?",
    "Che abbiamo oggi?",
    "Oggi?",
    "Domani?",
    "In questo mese?",
    "Fammi vedere il listino",
    "Quante persone ho in rubrica?",
    "Dove siamo?"
  ]) {
    assert.equal(classifyMaviIntent(message).route, MAVI_ROUTE.LOCAL_DATA);
  }
});

test("usa Qwen per conversazione, richieste generative e fallback non operativo", () => {
  for (const message of [
    "Ciao Mavi",
    "Dammi qualche idea per migliorare il salone",
    "Scrivi un post per Instagram sulla nuova promozione",
    "Chi sei?",
    "Perché?",
    "Mi aiuti?",
    "Che ne pensi?",
    "Raccontami qualcosa",
    "Come funziona Mavi?",
    "Mavi"
  ]) {
    assert.equal(classifyMaviIntent(message).route, MAVI_ROUTE.QWEN);
  }
});

test("solo l'input vuoto resta sul server come fallback tecnico", () => {
  assert.equal(classifyMaviIntent("").route, MAVI_ROUTE.SERVER);
  assert.equal(classifyMaviIntent("   ").route, MAVI_ROUTE.SERVER);
});

test("solo local-data e qwen possono bypassare il server", () => {
  assert.equal(shouldBypassServer(MAVI_ROUTE.LOCAL_DATA), true);
  assert.equal(shouldBypassServer(MAVI_ROUTE.QWEN), true);
  assert.equal(shouldBypassServer(MAVI_ROUTE.BUSINESS_ENGINE), false);
  assert.equal(shouldBypassServer(MAVI_ROUTE.SERVER), false);
});
