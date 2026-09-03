import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const adaptiveRuntime = fs.readFileSync(new URL("../mavi-adaptive-runtime.js", import.meta.url), "utf8");
const fastRuntime = fs.readFileSync(new URL("../mavi-fast-runtime.js", import.meta.url), "utf8");

test("Mavi exposes non-blocking local model warmup state", () => {
  assert.match(adaptiveRuntime, /isCurrentReady:\s*currentTierLoaded/);
  assert.match(adaptiveRuntime, /warmup,/);
});

test("generic routing does not wait for a cold local model", () => {
  assert.match(fastRuntime, /if \(!models\.isCurrentReady\?\.\(\)\) \{/);
  assert.match(fastRuntime, /models\.warmup\?\.\(\);\s*return null;/s);
});

test("ready local model has a bounded response budget", () => {
  assert.match(fastRuntime, /setTimeout\(\(\) => resolve\(null\), 3000\)/);
});
