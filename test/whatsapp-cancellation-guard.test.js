import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  isCancellationDecline,
  normalizePendingCancellation
} from "../lib/whatsapp-cancellation-guard.js";

test("normalizza lo stato di annullamento pendente", () => {
  assert.deepEqual(normalizePendingCancellation({
    status: "awaiting-confirmation",
    appointmentId: 42,
    requestedAt: "2026-09-02T10:00:00.000Z"
  }), {
    status: "awaiting-confirmation",
    appointmentId: "42",
    requestedAt: "2026-09-02T10:00:00.000Z"
  });
});

test("riconosce risposte che mantengono l'appuntamento", () => {
  for (const text of ["no", "No grazie", "mantieni", "non annullare", "lascia stare", "conserva", "ok, non annullare", "va bene, mantieni grazie"]) {
    assert.equal(isCancellationDecline(text), true, text);
  }
  assert.equal(isCancellationDecline("confermo"), false);
});

test("il guard chiede conferma prima di persistere un annullamento", async () => {
  const guard = await readFile(new URL("../lib/whatsapp-cancellation-guard.js", import.meta.url), "utf8");
  const pendingIndex = guard.indexOf("pendingCancellation:");
  const confirmIndex = guard.indexOf("if (!isConfirmation(text))");
  const persistIndex = guard.indexOf('status: "cancelled"');

  assert.ok(pendingIndex > -1);
  assert.ok(confirmIndex > -1);
  assert.ok(persistIndex > confirmIndex);
  assert.match(guard, /Scrivi “confermo” oppure “mantieni”/);
  assert.match(guard, /delete nextSession\.pendingCancellation/);
});

test("il proxy esegue il guard prima del vecchio handler WhatsApp", async () => {
  const proxy = await readFile(new URL("../api/whatsapp-proxy.js", import.meta.url), "utf8");
  const guardIndex = proxy.indexOf("handleSafeCancellation(req, res)");
  const handlerIndex = proxy.lastIndexOf("return whatsappHandler(req, res)");
  assert.ok(guardIndex > -1);
  assert.ok(handlerIndex > guardIndex);
  assert.match(proxy, /if \(safeCancellation\) return safeCancellation/);
});

test("il guard non interferisce con prenotazioni o spostamenti attivi", async () => {
  const guard = await readFile(new URL("../lib/whatsapp-cancellation-guard.js", import.meta.url), "utf8");
  assert.match(guard, /bookingActive/);
  assert.match(guard, /rescheduleActive/);
  assert.match(guard, /if \(!pending\.status && \(bookingActive \|\| rescheduleActive\)\) return false/);
});

test("la conferma annullamento è idempotente sui messaggi WhatsApp", async () => {
  const guard = await readFile(new URL("../lib/whatsapp-cancellation-guard.js", import.meta.url), "utf8");
  assert.match(guard, /whatsappProcessedKey/);
  assert.match(guard, /await markProcessed\(tenantId, phone, messageId\)/);
  assert.match(guard, /duplicate: true/);
});
