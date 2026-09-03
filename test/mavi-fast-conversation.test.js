import test from "node:test";
import assert from "node:assert/strict";
import { answerFastConversation } from "../lib/mavi-fast-conversation.js";

test("risponde subito a saluti e richieste su Mavi", () => {
  for (const message of ["Ciao", "Buongiorno Mavi", "Chi sei", "Mavi", "Cosa sai fare?", "Come mi puoi aiutare?"]) {
    const result = answerFastConversation(message, { business: { name: "Studio Demo" } });
    assert.equal(result.handled, true);
    assert.ok(result.answer.length > 20);
  }
});

test("mantiene un tono più ampio del vecchio fallback servizi-prezzi", () => {
  const result = answerFastConversation("Ciao", {});
  assert.equal(result.handled, true);
  assert.match(result.answer, /appuntamenti/i);
  assert.match(result.answer, /idee|decisioni/i);
});

test("non intercetta domande generiche che devono restare a Qwen o al fallback completo", () => {
  for (const message of ["Spiegami la fotosintesi", "Dammi tre idee per una campagna estiva", "Perché il cielo è blu?"]) {
    assert.equal(answerFastConversation(message, {}).handled, false);
  }
});

test("non intercetta input vuoto", () => {
  assert.equal(answerFastConversation("   ", {}).handled, false);
});
