import test from "node:test";
import assert from "node:assert/strict";
import {
  loadBusinessEngine,
  loadConversationalProxy,
  loadOperationalChatBuilder
} from "../lib/chat-entry-loader.js";

test("chat entry exposes lazy loaders without initializing handlers eagerly", () => {
  assert.equal(typeof loadBusinessEngine, "function");
  assert.equal(typeof loadConversationalProxy, "function");
  assert.equal(typeof loadOperationalChatBuilder, "function");
});
