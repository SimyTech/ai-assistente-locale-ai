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
  assert.match(text, /Benvenuto da Salone Demo/);
  assert.match(text, /informazioni, disponibilità e prenotazioni/);
  assert.match(text, /https:\/\/www\.maviri\.it\/mavi\/tenant-1/);
});

test("buildWhatsAppWelcome funziona anche senza nome attività", () => {
  assert.equal(
    buildWhatsAppWelcome("https://www.maviri.it", "tenant-2"),
    "Ciao! Benvenuto. Per informazioni, disponibilità e prenotazioni entra in Mavi Chat: https://www.maviri.it/mavi/tenant-2"
  );
});

test("link vuoto senza tenant", () => {
  assert.equal(buildMaviChatUrl("https://www.maviri.it", ""), "");
});
