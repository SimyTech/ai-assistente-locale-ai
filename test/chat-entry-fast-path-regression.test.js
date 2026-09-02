import test from "node:test";
import assert from "node:assert/strict";
import { isDirectOperationalAction, normalizeExplicitDateTimeMessage } from "../api/chat-entry.js";

test("fast path never captures conversational chat", () => {
  assert.equal(isDirectOperationalAction({ action: "chat", message: "sposta un appuntamento" }), false);
});

test("explicit date-time normalization remains chat-only", () => {
  const operation = { action: "book", message: "10/9 alle 9" };
  assert.deepEqual(normalizeExplicitDateTimeMessage(operation), operation);

  const chat = normalizeExplicitDateTimeMessage({ action: "chat", message: "10/9 alle 9" });
  assert.match(chat.message, /^ore 09:00 /);
});
