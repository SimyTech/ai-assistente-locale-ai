import test from "node:test";
import assert from "node:assert/strict";
import { loadOperationalChatBuilder } from "../lib/chat-entry-loader.js";

test("operational chat builder is loaded on demand", async () => {
  const builder = await loadOperationalChatBuilder();
  assert.equal(typeof builder, "function");
});
