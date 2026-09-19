import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { detectCancellation, detectReschedule } from "../api/chat.js";

test("riconosce lo spostamento senza confonderlo con annullamento o prenotazione", () => {
  assert.equal(detectReschedule("Vorrei spostare il mio appuntamento"), true);
  assert.equal(detectReschedule("Posso cambiare giorno dell'appuntamento?"), true);
  assert.equal(detectReschedule("Vorrei prenotare un appuntamento"), false);
  assert.equal(detectCancellation("Vorrei spostare il mio appuntamento"), false);
});

test("Mavi Client Chat conserva lo spostamento e usa update solo dopo conferma", async () => {
  const html = await readFile(new URL("../mavi.html", import.meta.url), "utf8");
  assert.match(html, /pendingReschedule/);
  assert.match(html, /collecting-new-slot/);
  assert.match(html, /confirmation-required/);
  assert.match(html, /api\("update"/);
  assert.match(html, /Prenotazione spostata/);
});
