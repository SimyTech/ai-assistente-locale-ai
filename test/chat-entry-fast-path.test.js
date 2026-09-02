import test from "node:test";
import assert from "node:assert/strict";
import { isDirectOperationalAction } from "../api/chat-entry.js";

test("direct operational actions bypass the conversational proxy", () => {
  for (const action of [
    "availability",
    "book",
    "update",
    "cancel",
    "confirm-attendance",
    "client",
    "context",
    "public-context",
    "owner-pull"
  ]) {
    assert.equal(isDirectOperationalAction({ action }), true, action);
  }
});

test("chat and owner-sync keep their existing normalization/proxy path", () => {
  assert.equal(isDirectOperationalAction({ action: "chat" }), false);
  assert.equal(isDirectOperationalAction({ action: "owner-sync" }), false);
  assert.equal(isDirectOperationalAction({}), false);
});
