import test from "node:test";
import assert from "node:assert/strict";
import { parseLocalAgendaPeriod } from "../lib/mavi-local-date.js";

const now = new Date(2026, 8, 3, 12, 0, 0);

test("interpreta giorni relativi e giorni della settimana", () => {
  assert.equal(parseLocalAgendaPeriod("dopodomani", now).start, "2026-09-05");
  assert.equal(parseLocalAgendaPeriod("lunedì prossimo", now).start, "2026-09-07");
  assert.equal(parseLocalAgendaPeriod("martedì scorso", now).start, "2026-09-01");
});

test("interpreta date numeriche e mesi futuri", () => {
  assert.equal(parseLocalAgendaPeriod("il 15/09", now).start, "2026-09-15");
  assert.equal(parseLocalAgendaPeriod("il 15", now).start, "2026-09-15");
  assert.equal(parseLocalAgendaPeriod("15 ottobre", now).start, "2026-10-15");
  assert.deepEqual(parseLocalAgendaPeriod("mese prossimo", now), { start: "2026-10-01", end: "2026-10-31", label: "il mese prossimo", kind: "month" });
});

test("interpreta intervalli e mesi precedenti", () => {
  assert.deepEqual(parseLocalAgendaPeriod("mese scorso", now), { start: "2026-08-01", end: "2026-08-31", label: "il mese scorso", kind: "month" });
  assert.deepEqual(parseLocalAgendaPeriod("settimana scorsa", now), { start: "2026-08-24", end: "2026-08-30", label: "la settimana scorsa", kind: "week" });
  assert.deepEqual(parseLocalAgendaPeriod("ultimi 10 giorni", now), { start: "2026-08-25", end: "2026-09-03", label: "ultimi 10 giorni", kind: "range" });
});

test("interpreta periodi correnti e anni relativi", () => {
  assert.deepEqual(parseLocalAgendaPeriod("in questo mese?", now), { start: "2026-09-01", end: "2026-09-30", label: "questo mese", kind: "month" });
  assert.deepEqual(parseLocalAgendaPeriod("questa settimana", now), { start: "2026-08-31", end: "2026-09-06", label: "questa settimana", kind: "week" });
  assert.deepEqual(parseLocalAgendaPeriod("quest'anno", now), { start: "2026-01-01", end: "2026-12-31", label: "quest'anno", kind: "year" });
  assert.deepEqual(parseLocalAgendaPeriod("anno scorso", now), { start: "2025-01-01", end: "2025-12-31", label: "l'anno scorso", kind: "year" });
});
