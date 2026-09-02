import test from "node:test";
import assert from "node:assert/strict";
import { detectCancellation, detectExplicitConfirmation } from "../api/chat.js";

test("Mavi non trasforma una frase contraddittoria in conferma", () => {
  for (const text of [
    "sì, ma non confermo",
    "ok, annulla",
    "va bene, lascia perdere",
    "perfetto, non prenotare",
    "procedi no aspetta"
  ]) {
    assert.equal(detectExplicitConfirmation(text), false, text);
  }
});

test("Mavi riconosce conferme realmente esplicite", () => {
  for (const text of ["confermo", "sì confermo", "ok", "va bene", "procedi", "prenota"]) {
    assert.equal(detectExplicitConfirmation(text), true, text);
  }
});

test("Mavi dà precedenza all'annullamento quando la frase inizia con assenso", () => {
  for (const text of ["ok, annulla", "sì, cancella", "va bene, lascia perdere", "perfetto, non posso venire"]) {
    assert.equal(detectCancellation(text), true, text);
    assert.equal(detectExplicitConfirmation(text), false, text);
  }
});
