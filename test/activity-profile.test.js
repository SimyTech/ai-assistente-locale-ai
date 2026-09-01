import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_PRESETS,
  WORKFLOW_MODES,
  activityProfileKey,
  normalizeActivityProfile,
  presetForSector
} from "../lib/activity-profile.js";

test("supporta flussi diversi dall'appuntamento", () => {
  assert.deepEqual(WORKFLOW_MODES, ["appointment", "walk-in", "mixed", "none"]);
  assert.equal(normalizeActivityProfile({ sector: "retail" }).capabilities.appointments, false);
  assert.equal(normalizeActivityProfile({ sector: "fitness" }).capabilities.walkIns, true);
});

test("i preset cambiano linguaggio senza cambiare il motore", () => {
  assert.equal(presetForSector("health").labels.client, "Paziente");
  assert.equal(presetForSector("automotive").labels.service, "Intervento");
  assert.equal(presetForSector("unknown").sector, "generic");
  assert.ok(Object.keys(ACTIVITY_PRESETS).length >= 8);
});

test("le etichette personalizzate prevalgono sui preset", () => {
  const profile = normalizeActivityProfile({
    name: "Associazione Alfa",
    sector: "fitness",
    workflowMode: "mixed",
    labels: { service: "Corso", client: "Socio", appointment: "Iscrizione" }
  });
  assert.equal(profile.labels.service, "Corso");
  assert.equal(profile.labels.client, "Socio");
  assert.equal(profile.labels.appointment, "Iscrizione");
  assert.equal(profile.capabilities.appointments, true);
  assert.equal(profile.capabilities.walkIns, true);
});

test("il profilo resta separato per tenant", () => {
  assert.equal(activityProfileKey("officina-uno"), "maviri:tenant:officina-uno:activity-profile");
  assert.notEqual(activityProfileKey("officina-uno"), activityProfileKey("studio-due"));
});
