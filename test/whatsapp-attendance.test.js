import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("WhatsApp registra la conferma di presenza senza confonderla con una prenotazione", async () => {
  const [chat, whatsapp] = await Promise.all([
    readFile(new URL("../api/chat.js", import.meta.url), "utf8"),
    readFile(new URL("../api/whatsapp.js", import.meta.url), "utf8")
  ]);
  assert.match(chat, /action === "confirm-attendance"/);
  assert.match(chat, /clientConfirmedAt: confirmedAt/);
  assert.match(whatsapp, /function confirmRequestedAttendance/);
  assert.match(whatsapp, /normalizeBooking\(session\.booking\)\.status \|\| !isConfirmation\(text\)/);
});
