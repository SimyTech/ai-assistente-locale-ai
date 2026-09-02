import test from "node:test";
import assert from "node:assert/strict";
import {
  loadBusinessEngine,
  loadConversationalProxy,
  loadOperationalChatBuilder
} from "../lib/chat-entry-loader.js";

test("lazy handler loaders are callable", () => {
  assert.equal(typeof loadBusinessEngine, "function");
  assert.equal(typeof loadConversationalProxy, "function");
  assert.equal(typeof loadOperationalChatBuilder, "function");
});
