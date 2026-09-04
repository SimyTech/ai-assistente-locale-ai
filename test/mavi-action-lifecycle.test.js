import test from "node:test";
import assert from "node:assert/strict";
import { createActionLifecycle, proposalActionId } from "../lib/mavi-action-lifecycle.js";

const proposal = {
  kind: "message-draft",
  channel: "whatsapp",
  recipientName: "Mario Rossi",
  recipient: "+391234567890",
  sourceType: "inactive-client",
  text: "Ciao Mario, vuoi fissare un nuovo appuntamento?"
};

test("genera un id stabile per la stessa proposta", () => {
  assert.equal(proposalActionId(proposal), proposalActionId({ ...proposal }));
  assert.notEqual(proposalActionId(proposal), proposalActionId({ ...proposal, text: "Testo diverso" }));
});

test("una proposta deve essere approvata prima della richiesta invio", () => {
  const lifecycle = createActionLifecycle();
  assert.equal(lifecycle.propose(proposal).status, "proposed");
  assert.equal(lifecycle.requestSend(proposal, 1000).accepted, false);
  assert.equal(lifecycle.approve(proposal, 2000).status, "approved");
  assert.equal(lifecycle.requestSend(proposal, 3000).accepted, true);
  assert.equal(lifecycle.get(proposal).status, "send-requested");
});

test("blocca richieste di invio duplicate", () => {
  const lifecycle = createActionLifecycle();
  lifecycle.approve(proposal, 1000);
  assert.equal(lifecycle.requestSend(proposal, 2000).accepted, true);
  const duplicate = lifecycle.requestSend(proposal, 3000);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.duplicate, true);
});

test("una modifica crea una nuova proposta non approvata", () => {
  const lifecycle = createActionLifecycle();
  lifecycle.approve(proposal, 1000);
  const edited = { ...proposal, text: "Nuovo testo" };
  const result = lifecycle.edit(proposal, edited);
  assert.equal(result.status, "proposed");
  assert.equal(lifecycle.get(proposal), null);
  assert.equal(lifecycle.requestSend(edited, 2000).accepted, false);
});

test("completamento è valido solo dopo richiesta invio", () => {
  const lifecycle = createActionLifecycle();
  assert.equal(lifecycle.complete(proposal, 1000).accepted, false);
  lifecycle.approve(proposal, 2000);
  lifecycle.requestSend(proposal, 3000);
  assert.equal(lifecycle.complete(proposal, 4000).accepted, true);
  assert.equal(lifecycle.get(proposal).status, "completed");
  assert.equal(lifecycle.requestSend(proposal, 5000).duplicate, true);
});

test("registra una prenotazione come esito solo dopo il completamento dell'azione", () => {
  const lifecycle = createActionLifecycle();
  assert.equal(lifecycle.recordOutcome(proposal, { type: "booked", value: 70 }, 1000).accepted, false);
  lifecycle.approve(proposal, 2000);
  lifecycle.requestSend(proposal, 3000);
  lifecycle.complete(proposal, 4000);
  const result = lifecycle.recordOutcome(proposal, { type: "booked", value: 70, appointmentId: "apt-123" }, 5000);
  assert.equal(result.accepted, true);
  assert.equal(result.action.status, "completed");
  assert.equal(result.action.outcome, "booked");
  assert.equal(result.action.outcomeValue, 70);
  assert.equal(result.action.appointmentId, "apt-123");
  assert.equal(result.action.outcomeAt, 5000);
});

test("registra esiti senza prenotazione senza attribuire valore", () => {
  const lifecycle = createActionLifecycle();
  lifecycle.approve(proposal, 1000);
  lifecycle.requestSend(proposal, 2000);
  lifecycle.complete(proposal, 3000);
  const result = lifecycle.recordOutcome(proposal, { type: "no-booking", value: 999, appointmentId: "fake" }, 4000);
  assert.equal(result.accepted, true);
  assert.equal(result.action.outcome, "no-booking");
  assert.equal(result.action.outcomeValue, 0);
  assert.equal(result.action.appointmentId, "");
});

test("rifiuta tipi di esito non previsti", () => {
  const lifecycle = createActionLifecycle();
  lifecycle.approve(proposal, 1000);
  lifecycle.requestSend(proposal, 2000);
  lifecycle.complete(proposal, 3000);
  const result = lifecycle.recordOutcome(proposal, { type: "maybe" }, 4000);
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "invalid-outcome");
  assert.equal(lifecycle.get(proposal).outcome, null);
});

test("un errore può tornare in stato approvato solo con retry esplicito", () => {
  const lifecycle = createActionLifecycle();
  lifecycle.approve(proposal, 1000);
  lifecycle.requestSend(proposal, 2000);
  assert.equal(lifecycle.fail(proposal, "canale non disponibile", 3000).accepted, true);
  assert.equal(lifecycle.get(proposal).status, "failed");
  assert.equal(lifecycle.requestSend(proposal, 4000).accepted, false);
  assert.equal(lifecycle.retry(proposal).accepted, true);
  assert.equal(lifecycle.get(proposal).status, "approved");
});
