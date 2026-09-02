import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  isDirectOperationalAction,
  normalizeOwnerSync
} from "../api/chat-entry.js";

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

test("chat remains on the conversational path", () => {
  assert.equal(isDirectOperationalAction({ action: "chat" }), false);
  assert.equal(isDirectOperationalAction({ action: "owner-sync" }), false);
  assert.equal(isDirectOperationalAction({}), false);
});

test("owner-sync is normalized before using the direct business engine", () => {
  const completedAt = "2026-09-02T10:30:00.000Z";
  const body = normalizeOwnerSync({
    action: "owner-sync",
    updatedAt: "2026-09-02T10:00:00.000Z",
    appointments: [{
      id: "a1",
      status: "completed",
      updatedAt: "2026-09-02T09:00:00.000Z",
      completedAt
    }],
    settings: {
      hours: [
        { open: "09:00", close: "18:00" },
        { closed: true }
      ]
    }
  });

  assert.equal(body.appointments[0].updatedAt, completedAt);
  assert.deepEqual(body.settings.hours.monday, { open: "09:00", close: "18:00" });
  assert.deepEqual(body.settings.hours.tuesday, { closed: true });
  assert.deepEqual(body.settings.hours.sunday, { closed: true });
});

test("business and conversational modules are lazy-loaded through the loader module", () => {
  const entrySource = fs.readFileSync(new URL("../api/chat-entry.js", import.meta.url), "utf8");
  const loaderSource = fs.readFileSync(new URL("../lib/chat-entry-loader.js", import.meta.url), "utf8");

  assert.equal(entrySource.includes('import chatHandler from "./chat.js"'), false);
  assert.equal(entrySource.includes('import chatProxy from "./chat-proxy.js"'), false);
  assert.equal(entrySource.includes('loadBusinessEngine'), true);
  assert.equal(entrySource.includes('loadConversationalProxy'), true);
  assert.equal(loaderSource.includes('await import("../api/chat.js")'), true);
  assert.equal(loaderSource.includes('await import("../api/chat-proxy.js")'), true);
  assert.equal(loaderSource.includes('await import("./operational-chat.js")'), true);
});
