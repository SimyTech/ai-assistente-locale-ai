import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const adaptive = fs.readFileSync(new URL("../mavi-adaptive-runtime.js", import.meta.url), "utf8");
const fast = fs.readFileSync(new URL("../mavi-fast-runtime.js", import.meta.url), "utf8");

test("Mavi conserva la conversazione nella sessione", () => {
  assert.match(adaptive, /MAVIRI_MAVI_CONVERSATION_V1/);
  assert.match(adaptive, /sessionStorage\.getItem\(CONVERSATION_STORAGE_KEY\)/);
  assert.match(adaptive, /sessionStorage\.setItem\(CONVERSATION_STORAGE_KEY/);
});

test("la memoria resta limitata agli ultimi messaggi", () => {
  assert.match(adaptive, /parsed\.slice\(-8\)/);
  assert.match(adaptive, /appendMaviConversation\(conversation, user, assistant\)/);
});

test("anche le risposte rapide vengono passate alla memoria del modello", () => {
  assert.match(fast, /window\.MaviModels\?\.remember\?\.\(message, answer\)/);
  assert.match(fast, /rememberTurn\(message, fastConversation\.answer\)/);
  assert.match(fast, /rememberTurn\(message, fast\.answer\)/);
});

test("la memoria conserva il messaggio originale quando il runtime usa un contesto arricchito", () => {
  assert.match(fast, /effectiveMessage = resolvedContext\.enrichedMessage/);
  assert.match(fast, /rememberTurn\(message, fastConversation\.answer\)/);
  assert.doesNotMatch(fast, /rememberTurn\(effectiveMessage, fastConversation\.answer\)/);
});

test("il reset cancella anche la memoria persistita", () => {
  assert.match(adaptive, /sessionStorage\.removeItem\(CONVERSATION_STORAGE_KEY\)/);
});

test("il prompt istruisce Mavi a risolvere riferimenti contestuali", () => {
  assert.match(adaptive, /Mantieni continuità con i messaggi precedenti/);
  assert.match(adaptive, /e domani\?/);
});
