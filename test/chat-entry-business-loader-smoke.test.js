import test from "node:test";
import assert from "node:assert/strict";
import { loadBusinessEngine } from "../lib/chat-entry-loader.js";

test("business engine is loaded on demand", async () => {
  const handler = await loadBusinessEngine();
  assert.equal(typeof handler, "function");
});
