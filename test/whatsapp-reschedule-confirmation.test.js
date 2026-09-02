import test from "node:test";
import assert from "node:assert/strict";

import {
  isRescheduleConfirmation,
  isRescheduleDecline,
  rescheduleConfirmationMessage
} from "../lib/whatsapp-reschedule.js";

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
