import test from "node:test";
import assert from "node:assert/strict";
import { rankProposalsByObservedOutcomes } from "../lib/mavi-observed-priority.js";

const proposal = (strategy, service) => ({ kind: "message-draft", strategy, recommendedService: service, sourceType: "weak-time-band" });
const action = (strategy, service, outcome, value = 0) => ({
  proposal: proposal(strategy, service),
  outcome,
  outcomeValue: value
});

test("ordina prima le proposte supportate da risultati osservati migliori", () => {
  const proposals = [proposal("generic-recontact", "Taglio"), proposal("targeted-recontact", "Colore")];
  const actions = [
    action("generic-recontact", "Taglio", "booked", 30),
    action("generic-recontact", "Taglio", "no-booking"),
    action("generic-recontact", "Taglio", "no-booking"),
    action("targeted-recontact", "Colore", "booked", 70),
    action("targeted-recontact", "Colore", "booked", 80),
    action("targeted-recontact", "Colore", "no-booking")
  ];
  const ranked = rankProposalsByObservedOutcomes(proposals, actions, { minimumObserved: 3 });
  assert.equal(ranked[0].proposal.strategy, "targeted-recontact");
  assert.equal(ranked[0].hasObservedEvidence, true);
  assert.equal(ranked[0].priorityEvidence.forecast, false);
  assert.match(ranked[0].note, /non è una previsione/i);
});

test("mantiene l'ordine originale quando il campione osservato è insufficiente", () => {
  const proposals = [proposal("first", "A"), proposal("second", "B")];
  const actions = [action("second", "B", "booked", 100)];
  const ranked = rankProposalsByObservedOutcomes(proposals, actions, { minimumObserved: 3 });
  assert.equal(ranked[0].proposal.strategy, "first");
  assert.equal(ranked[1].proposal.strategy, "second");
  assert.equal(ranked[0].hasObservedEvidence, false);
});

test("usa solo esiti osservati validi tramite il riepilogo centrale", () => {
  const proposals = [proposal("targeted-recontact", "Colore")];
  const actions = [
    action("targeted-recontact", "Colore", "booked", 70),
    action("targeted-recontact", "Colore", "pending", 1000),
    action("targeted-recontact", "Colore", null, 1000)
  ];
  const ranked = rankProposalsByObservedOutcomes(proposals, actions, { minimumObserved: 1 });
  assert.equal(ranked[0].priorityEvidence.observed, 1);
  assert.equal(ranked[0].priorityEvidence.recoveredValue, 70);
});
