import { rankProposalsByObservedOutcomes } from "./mavi-observed-priority.js";

const clean = value => String(value ?? "").trim();

function expose(row = {}) {
  const evidence = row?.priorityEvidence || null;
  return {
    ...row.proposal,
    observedPriority: Boolean(evidence),
    observedPriorityBasis: evidence?.basis || "",
    observedPriorityDimension: evidence?.dimension || "",
    observedPriorityLabel: evidence?.label || "",
    observedSample: Number(evidence?.observed || 0),
    observedBooked: Number(evidence?.booked || 0),
    observedBookingRate: Number(evidence?.bookingRate || 0),
    observedRecoveredValue: Number(evidence?.recoveredValue || 0),
    observedForecast: false,
    observedPriorityNote: clean(row?.note)
  };
}

export function buildRankedProactiveFlow(proposals = [], observedActions = [], { minimumObserved = 3, limit = 10 } = {}) {
  const ranked = rankProposalsByObservedOutcomes(proposals, observedActions, { minimumObserved });
  const max = Math.max(1, Number(limit) || 10);
  return ranked.slice(0, max).map(expose);
}
