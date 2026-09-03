import test from "node:test";
import assert from "node:assert/strict";
import { MAVI_CUSTOMER_MESSAGE_POLICY, buildMaviCustomerMessage, prepareOwnerApprovedCustomerMessage } from "../lib/mavi-customer-message-policy.js";

test("la policy richiede sempre conferma del titolare", () => {
  assert.equal(MAVI_CUSTOMER_MESSAGE_POLICY.ownerApprovalRequired, true);
  assert.deepEqual(MAVI_CUSTOMER_MESSAGE_POLICY.ownerModes, ["mavi_generated", "owner_edited", "owner_written"]);
  const proposal = prepareOwnerApprovedCustomerMessage({ kind:"smart_recall", client:{ id:"c1", name:"Anna", phone:"39000" }, context:{ service:"Taglio" } });
  assert.equal(proposal.approved, false);
  assert.equal(proposal.requiresOwnerApproval, true);
  assert.equal(proposal.channel, "whatsapp");
});

test("Mavi propone richiami positivi cordiali ed empatici senza colpevolizzare", () => {
  const message = buildMaviCustomerMessage("smart_recall", { name:"Anna Rossi" }, { service:"Taglio", suggestedSlot:"venerdì alle 15:00" });
  assert.match(message, /Ciao Anna/);
  assert.match(message, /come stai|Speriamo/i);
  assert.match(message, /Se ti (?:va|fa piacere)/);
  assert.match(message, /venerdì alle 15:00/);
  assert.doesNotMatch(message, /non vieni|non hai prenotato|devi|dovresti|mancato/i);
});

test("il titolare può modificare il testo proposto", () => {
  const proposal = prepareOwnerApprovedCustomerMessage({ kind:"inactive_recovery", client:{ name:"Luca" }, mode:"owner_edited", text:"Ciao Luca, come stai? Quando vuoi siamo qui." });
  assert.equal(proposal.messageMode, "owner_edited");
  assert.equal(proposal.message, "Ciao Luca, come stai? Quando vuoi siamo qui.");
  assert.equal(proposal.approved, false);
});

test("il titolare può scrivere completamente il messaggio", () => {
  const proposal = prepareOwnerApprovedCustomerMessage({ kind:"inactive_recovery", client:{ name:"Luca" }, mode:"owner_written", text:"Ciao Luca, se ti va chiamami quando preferisci." });
  assert.equal(proposal.messageMode, "owner_written");
  assert.equal(proposal.message, "Ciao Luca, se ti va chiamami quando preferisci.");
});

test("gestisce recupero cancellazione e no-show con tono non pressante", () => {
  const cancelled = buildMaviCustomerMessage("cancellation_recovery", { name:"Paola" }, { suggestedSlot:"domani alle 11:00" });
  const noShow = buildMaviCustomerMessage("no_show_recovery", { name:"Marco" }, {});
  assert.match(cancelled, /Scegli pure il momento che ti è più comodo/);
  assert.match(noShow, /speriamo sia tutto a posto/i);
  assert.doesNotMatch(`${cancelled} ${noShow}`, /colpa|assenza ingiustificata|non ti sei presentato/i);
});
