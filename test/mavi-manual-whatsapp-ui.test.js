import test from "node:test";
import assert from "node:assert/strict";
import { createManualWhatsappProposal, normalizeWhatsappRecipient } from "../lib/mavi-manual-whatsapp-ui.js";

test("normalizza un numero WhatsApp internazionale", () => {
  assert.equal(normalizeWhatsappRecipient("39 333 137 0039"), "+393331370039");
  assert.equal(normalizeWhatsappRecipient("0039 333 137 0039"), "+393331370039");
});

test("rifiuta numeri non validi", () => {
  assert.equal(normalizeWhatsappRecipient("333"), "");
  assert.equal(normalizeWhatsappRecipient("test"), "");
});

test("crea una proposta WhatsApp manuale sempre soggetta ad approvazione", () => {
  const proposal = createManualWhatsappProposal("+39 333 137 0039", "Messaggio di prova");
  assert.deepEqual(proposal, {
    kind: "message-draft",
    channel: "whatsapp",
    recipient: "+393331370039",
    recipientName: "+393331370039",
    text: "Messaggio di prova",
    requiresApproval: true,
    executable: false,
    sourceType: "manual-whatsapp"
  });
  assert.equal(createManualWhatsappProposal("+393331370039", ""), null);
});
