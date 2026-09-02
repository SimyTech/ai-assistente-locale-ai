import test from "node:test";
import assert from "node:assert/strict";
import { isDirectOperationalAction } from "../api/chat-entry.js";

test("direct operations remain on the lazy business-engine path", () => {
  assert.equal(isDirectOperationalAction({ action: "book" }), true);
  assert.equal(isDirectOperationalAction({ action: "cancel" }), true);
  assert.equal(isDirectOperationalAction({ action: "chat" }), false);
});
