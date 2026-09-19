import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { detectCancellation, detectPhoneNumber } from "../api/chat.js";

test("annullamento cliente ha un intento esplicito e rileva il telefono", () => {
  const message = "Vorrei annullare la prenotazione del 21 settembre alle 09:00. Telefono 0000000000.";
  assert.equal(detectCancellation(message), true);
  assert.equal(detectPhoneNumber(message), "0000000000");
});

test("Mavi Client Chat richiede conferma e usa l endpoint cancel", async () => {
  const html = await readFile(new URL("../mavi.html", import.meta.url), "utf8");
  assert.match(html, /pendingCancellation/);
  assert.match(html, /status==="confirmation-required"/);
  assert.match(html, /api\("cancel"/);
  assert.match(html, /Per annullare scrivi Confermo/);
});
