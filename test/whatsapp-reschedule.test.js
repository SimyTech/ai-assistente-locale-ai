import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  extractRescheduleDate,
  extractRescheduleTime,
  isRescheduleRequest,
  normalizeReschedule,
  selectCandidateByNumber
} from "../lib/whatsapp-reschedule.js";

test("riconosce richieste naturali di spostamento appuntamento", () => {
  assert.equal(isRescheduleRequest("Vorrei spostare l'appuntamento"), true);
  assert.equal(isRescheduleRequest("posso cambiare orario della prenotazione?"), true);
  assert.equal(isRescheduleRequest("vorrei prenotare"), false);
});

test("estrae date naturali per la nuova prenotazione", () => {
  assert.equal(extractRescheduleDate("spostalo a domani", "2026-09-02"), "2026-09-03");
  assert.equal(extractRescheduleDate("spostalo a dopodomani", "2026-09-02"), "2026-09-04");
  assert.equal(extractRescheduleDate("spostalo a venerdì", "2026-09-02"), "2026-09-04");
  assert.equal(extractRescheduleDate("spostalo al 06/09/2026", "2026-09-02"), "2026-09-06");
});

test("rifiuta date impossibili invece di inoltrarle al Business Engine", () => {
  assert.equal(extractRescheduleDate("spostalo al 31/02/2026", "2026-09-02"), "");
  assert.equal(extractRescheduleDate("spostalo al 2026-04-31", "2026-09-02"), "");
  assert.equal(extractRescheduleDate("spostalo al 29/02/2026", "2026-09-02"), "");
  assert.equal(extractRescheduleDate("spostalo al 29/02/2028", "2026-09-02"), "2028-02-29");
  assert.equal(extractRescheduleDate("spostalo al 00/12/2026", "2026-09-02"), "");
  assert.equal(extractRescheduleDate("spostalo al 15/13/2026", "2026-09-02"), "");
});

test("rifiuta date già passate ma consente oggi e date future", () => {
  assert.equal(extractRescheduleDate("spostalo al 01/09/2026", "2026-09-02"), "");
  assert.equal(extractRescheduleDate("spostalo al 2026-08-31", "2026-09-02"), "");
  assert.equal(extractRescheduleDate("spostalo al 02/09/2026", "2026-09-02"), "2026-09-02");
  assert.equal(extractRescheduleDate("spostalo al 03/09/2026", "2026-09-02"), "2026-09-03");
  assert.equal(extractRescheduleDate("spostalo al 01/09", "2026-09-02"), "");
});

test("estrae l'orario richiesto", () => {
  assert.equal(extractRescheduleTime("alle 15"), "15:00");
  assert.equal(extractRescheduleTime("ore 9:30"), "09:30");
});

test("seleziona in sicurezza uno degli appuntamenti numerati", () => {
  const candidates = ["a", "b", "c"];
  assert.equal(selectCandidateByNumber(candidates, "2"), "b");
  assert.equal(selectCandidateByNumber(candidates, "4"), "");
  assert.equal(selectCandidateByNumber(candidates, "annulla"), "");
});

test("normalizza lo stato di riprogrammazione persistito in sessione", () => {
  assert.deepEqual(normalizeReschedule({ status: "collecting-time", appointmentId: 12, date: "2026-09-04", candidates: [1, "2"] }), {
    status: "collecting-time",
    appointmentId: "12",
    date: "2026-09-04",
    time: "",
    candidates: ["1", "2"]
  });
});

test("il webhook conserva lo stato, usa update e accetta un nuovo giorno durante il flusso", async () => {
  const whatsapp = await readFile(new URL("../api/whatsapp.js", import.meta.url), "utf8");
  assert.match(whatsapp, /reschedule: normalizeReschedule\(stored\.reschedule\)/);
  assert.match(whatsapp, /reschedule: normalizeReschedule\(session\.reschedule\)/);
  assert.match(whatsapp, /function continueReschedule/);
  assert.match(whatsapp, /const requestedDate = extractRescheduleDate\(text, todayRome\(\)\)/);
  assert.match(whatsapp, /if \(requestedDate\) \{\s*state\.date = requestedDate;/);
  assert.match(whatsapp, /if \(!requestedTime\) state\.time = ""/);
  assert.match(whatsapp, /action: "update"/);
  assert.match(whatsapp, /selecting-appointment/);
  assert.match(whatsapp, /Quell.orario non è disponibile/);
  assert.match(whatsapp, /let responsePayload = await continueReschedule/);
});
