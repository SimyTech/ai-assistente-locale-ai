import test from "node:test";
import assert from "node:assert/strict";

import {
  narrowCancellationCandidates,
  normalizePendingCancellation
} from "../lib/whatsapp-cancellation-guard.js";

const appointments = [
  { id: "a1", date: "2026-09-03", time: "10:00", service: "Taglio", status: "confirmed", whatsapp: "+39111" },
  { id: "a2", date: "2026-09-03", time: "15:00", service: "Colore", status: "confirmed", whatsapp: "+39111" }
];

test("lo stato pendente conserva i candidati ambigui", () => {
  assert.deepEqual(normalizePendingCancellation({
    status: "selecting-appointment",
    candidates: ["a1", "a2", "a2"]
  }), {
    status: "selecting-appointment",
    appointmentId: "",
    requestedAt: "",
    candidates: ["a1", "a2"]
  });
});

test("una risposta con solo orario seleziona l'appuntamento pendente", () => {
  const result = narrowCancellationCandidates(appointments, ["a1", "a2"], "quello delle 15:00", "2026-09-02", { phone: "+39111", whatsapp: "+39111" });
  assert.equal(result?.id, "a2");
});

test("una risposta con solo servizio seleziona l'appuntamento pendente", () => {
  const result = narrowCancellationCandidates(appointments, ["a1", "a2"], "il colore", "2026-09-02", { phone: "+39111", whatsapp: "+39111" });
  assert.equal(result?.id, "a2");
});

test("non può selezionare un appuntamento fuori dai candidati salvati", () => {
  const result = narrowCancellationCandidates(appointments, ["a1"], "il colore", "2026-09-02", { phone: "+39111", whatsapp: "+39111" });
  assert.equal(result?.id, "a1");
});
