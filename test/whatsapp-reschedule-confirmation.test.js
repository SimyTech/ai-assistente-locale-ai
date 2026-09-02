import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  isRescheduleConfirmation,
  isRescheduleDecline,
  rescheduleConfirmationMessage
} from "../lib/whatsapp-reschedule.js";
import { selectedRescheduleState } from "../lib/whatsapp-reschedule-guard.js";

test("riconosce conferme esplicite dello spostamento", () => {
  assert.equal(isRescheduleConfirmation("confermo"), true);
  assert.equal(isRescheduleConfirmation("sì, confermo"), true);
  assert.equal(isRescheduleConfirmation("ok confermo"), true);
  assert.equal(isRescheduleConfirmation("va bene"), false);
  assert.equal(isRescheduleConfirmation("non confermo"), false);
});

test("riconosce il rifiuto dello spostamento senza confonderlo con una correzione", () => {
  assert.equal(isRescheduleDecline("mantieni"), true);
  assert.equal(isRescheduleDecline("lascia così"), true);
  assert.equal(isRescheduleDecline("non spostare"), true);
  assert.equal(isRescheduleDecline("annulla lo spostamento"), true);
  assert.equal(isRescheduleDecline("no, domani alle 16"), false);
});

test("genera una richiesta di conferma completa", () => {
  assert.equal(
    rescheduleConfirmationMessage(
      { service: "Taglio", date: "2026-09-03", time: "10:00" },
      { date: "2026-09-04", time: "16:00" }
    ),
    "Vuoi spostare Taglio dal 2026-09-03 alle 10:00 al 2026-09-04 alle 16:00? Scrivi “confermo” oppure “mantieni”."
  );
});

test("la selezione di un appuntamento conserva data e ora già richieste", () => {
  assert.deepEqual(
    selectedRescheduleState({
      status: "selecting-appointment",
      date: "2026-09-04",
      time: "16:00",
      requestedAt: "2026-09-02T15:00:00.000Z",
      candidates: ["a", "b"]
    }, "b"),
    {
      status: "checking-availability",
      appointmentId: "b",
      date: "2026-09-04",
      time: "16:00",
      requestedAt: "2026-09-02T15:00:00.000Z"
    }
  );

  assert.equal(selectedRescheduleState({ date: "2026-09-04", time: "" }, "a").status, "collecting-time");
  assert.equal(selectedRescheduleState({ date: "", time: "" }, "a").status, "collecting-date");
});

test("il guard salva il target iniziale prima di chiedere quale appuntamento spostare", async () => {
  const guard = await readFile(new URL("../lib/whatsapp-reschedule-guard.js", import.meta.url), "utf8");
  assert.match(guard, /if \(owned\.length > 1\)[\s\S]*date: extractRescheduleDate\(text, todayRome\(\)\)/);
  assert.match(guard, /if \(owned\.length > 1\)[\s\S]*time: extractRescheduleTime\(text\)/);
  assert.match(guard, /const next = selectedRescheduleState\(pending, selected\.id\)/);
  assert.match(guard, /requestConfirmation\([\s\S]*appointment: selected, pending: next/);
});
