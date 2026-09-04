import test from "node:test";
import assert from "node:assert/strict";
import { buildRankedProactiveFlow } from "../lib/mavi-ranked-proactive-flow.js";

const proposal = strategy => ({ kind: "message-draft", strategy, sourceType: "weak-time-band", requiresApproval: true, executable: false });
const action = (strategy, outcome, value = 0) => ({ proposal: proposal(strategy), outcome, outcomeValue: value });

test("porta nel flusso operativo prima la proposta con risultati osservati migliori", () => {
  const proposals = [proposal("generic-recontact"), proposal("targeted-recontact")];
  const actions = [
    action("generic-recontact", "booked", 30),
    action("generic-recontact", "no-booking"),
    action("generic-recontact", "no-booking"),
    action("targeted-recontact", "booked", 70),
    action("targeted-recontact", "booked", 80),
    action("targeted-recontact", "no-booking")
  ];
  const flow = buildRankedProactiveFlow(proposals, actions, { minimumObserved: 3 });
  assert.equal(flow[0].strategy, "targeted-recontact");
  assert.equal(flow[0].observedPriority, true);
  assert.equal(flow[0].observedSample, 3);
  assert.equal(flow[0].observedBooked, 2);
  assert.equal(flow[0].observedForecast, false);
  assert.equal(flow[0].requiresApproval, true);
  assert.equal(flow[0].executable, false);
});

test("non inventa priorità quando il campione è insufficiente", () => {
  const proposals = [proposal("first"), proposal("second")];
  const flow = buildRankedProactiveFlow(proposals, [action("second", "booked", 100)], { minimumObserved: 3 });
  assert.equal(flow[0].strategy, "first");
  assert.equal(flow[0].observedPriority, false);
  assert.equal(flow[1].strategy, "second");
  assert.match(flow[0].observedPriorityNote, /ordine originale/i);
});

test("rispetta il limite senza rendere eseguibili le proposte", () => {
  const flow = buildRankedProactiveFlow([proposal("a"), proposal("b"), proposal("c")], [], { limit: 2 });
  assert.equal(flow.length, 2);
  assert.equal(flow.every(item => item.executable === false), true);
  assert.equal(flow.every(item => item.requiresApproval === true), true);
});
