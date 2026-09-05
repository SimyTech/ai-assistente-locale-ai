import test from "node:test";
import assert from "node:assert/strict";
import { buildMaviChatUrl, buildWhatsAppWelcome } from "../mavi-chat-link.js";

test("buildMaviChatUrl crea il link pubblico tenant-scoped", () => {
  assert.equal(
    buildMaviChatUrl("https://www.maviri.it/", "salone demo"),
    "https://www.maviri.it/mavi/salone%20demo"
  );
});

test("buildWhatsAppWelcome include Mavi Chat e il link personale", () => {
  const text = buildWhatsAppWelcome("https://www.maviri.it", "tenant-1", "Salone Demo");
  assert.match(text, /Mavi Chat/);
  assert.match(text, /Salone Demo/);
  assert.match(text, /https:\/\/www\.maviri\.it\/mavi\/tenant-1/);
});

test("link vuoto senza tenant", () => {
  assert.equal(buildMaviChatUrl("https://www.maviri.it", ""), "");
});
