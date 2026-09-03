import test from "node:test";
import assert from "node:assert/strict";
import { createProposalUiState, reduceProposalUi } from "../lib/mavi-proactive-action-ui.js";

const proposal = {
  kind: "message-draft",
  channel: "whatsapp",
  recipientName: "Mario Rossi",
  recipient: "+391234567890",
  text: "Ciao Mario, ti va di fissare un nuovo appuntamento?",
  requiresApproval: true,
  executable: false
};

test("l'invio resta disabilitato prima dell'approvazione", () => {
  const state = createProposalUiState(proposal, { channelReady: true });
  assert.equal(state.approved, false);
  assert.equal(state.sendEnabled, false);
  const attempted = reduceProposalUi(state, { type: "request-send" });
  assert.equal(attempted.sentRequested, false);
});

test("approvazione abilita invio solo se il canale è disponibile", () => {
  const unavailable = reduceProposalUi(createProposalUiState(proposal, { channelReady: false }), { type: "approve" });
  assert.equal(unavailable.approved, true);
  assert.equal(unavailable.sendEnabled, false);

  const available = reduceProposalUi(createProposalUiState(proposal, { channelReady: true }), { type: "approve" });
  assert.equal(available.approved, true);
  assert.equal(available.sendEnabled, true);
});

test("una modifica revoca l'approvazione precedente", () => {
  let state = reduceProposalUi(createProposalUiState(proposal, { channelReady: true }), { type: "approve" });
  assert.equal(state.sendEnabled, true);
  state = reduceProposalUi(state, { type: "edit" });
  assert.equal(state.approved, false);
  assert.equal(state.sendEnabled, false);
  state = reduceProposalUi(state, { type: "change-text", text: "Testo aggiornato" });
  state = reduceProposalUi(state, { type: "save-edit" });
  assert.equal(state.proposal.text, "Testo aggiornato");
  assert.equal(state.sendEnabled, false);
});

test("la richiesta di invio richiede approvazione e canale pronto", () => {
  let state = createProposalUiState(proposal, { channelReady: true });
  state = reduceProposalUi(state, { type: "approve" });
  state = reduceProposalUi(state, { type: "request-send" });
  assert.equal(state.sentRequested, true);
  assert.equal(state.sendEnabled, false);
});

test("se il canale diventa indisponibile dopo approvazione blocca di nuovo invio", () => {
  let state = createProposalUiState(proposal, { channelReady: true });
  state = reduceProposalUi(state, { type: "approve" });
  assert.equal(state.sendEnabled, true);
  state = reduceProposalUi(state, { type: "channel-status", ready: false });
  assert.equal(state.sendEnabled, false);
  const attempted = reduceProposalUi(state, { type: "request-send" });
  assert.equal(attempted.sentRequested, false);
});

test("mostra il completamento reale solo dopo una richiesta in corso", () => {
  let state = reduceProposalUi(createProposalUiState(proposal, { channelReady: true }), { type: "send-complete" });
  assert.equal(state.deliveryStatus, "idle");
  state = reduceProposalUi(state, { type: "approve" });
  state = reduceProposalUi(state, { type: "request-send" });
  assert.equal(state.deliveryStatus, "sending");
  state = reduceProposalUi(state, { type: "send-complete" });
  assert.equal(state.deliveryStatus, "completed");
  assert.equal(state.sendEnabled, false);
});

test("dopo un errore permette un nuovo invio esplicito", () => {
  let state = reduceProposalUi(createProposalUiState(proposal, { channelReady: true }), { type: "approve" });
  state = reduceProposalUi(state, { type: "request-send" });
  state = reduceProposalUi(state, { type: "send-failed", error: "Canale temporaneamente non disponibile" });
  assert.equal(state.deliveryStatus, "failed");
  assert.equal(state.deliveryError, "Canale temporaneamente non disponibile");
  assert.equal(state.sendEnabled, false);

  state = reduceProposalUi(state, { type: "retry-send" });
  assert.equal(state.deliveryStatus, "idle");
  assert.equal(state.sentRequested, false);
  assert.equal(state.sendEnabled, true);
  state = reduceProposalUi(state, { type: "request-send" });
  assert.equal(state.deliveryStatus, "sending");
});
