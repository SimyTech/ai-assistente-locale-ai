import test from "node:test";
import assert from "node:assert/strict";

import {
  whatsappClientChatReply,
  whatsappClientChatUrl
} from "../api/whatsapp.js";

test("builds the tenant-specific Mavi Client Chat URL", () => {
  assert.equal(
    whatsappClientChatUrl("https://www.maviri.it/", "simytech-574244"),
    "https://www.maviri.it/mavi/simytech-574244"
  );
});

test("builds the automatic WhatsApp handoff message", () => {
  assert.equal(
    whatsappClientChatReply("https://www.maviri.it", "simytech-574244"),
    "Ciao! Per informazioni, disponibilità e prenotazioni apri Mavi Client Chat: https://www.maviri.it/mavi/simytech-574244"
  );
});

test("encodes tenant identifiers before placing them in the URL", () => {
  assert.equal(
    whatsappClientChatUrl("https://www.maviri.it", "attività demo"),
    "https://www.maviri.it/mavi/attivit%C3%A0%20demo"
  );
});
