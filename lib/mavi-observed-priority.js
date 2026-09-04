import { summarizeActionOutcomes } from "./mavi-action-outcome-insights.js";

const clean = value => String(value ?? "").trim();
const normalize = value => clean(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();

function proposalDimensionValue(proposal = {}, dimension = "strategy") {
  if (dimension === "service") return clean(proposal.recommendedService || proposal.service);
  if (dimension === "band") return clean(proposal.targetBand || proposal.preferredBand);
  if (dimension === "source") return clean(proposal.sourceType);
  return clean(proposal.strategy || proposal.sourceType);
}

function evidenceFor(proposal, actions, dimension, minimumObserved) {
  const value = proposalDimensionValue(proposal, dimension);
  if (!value) return null;
  const summary = summarizeActionOutcomes(actions, { dimension, minimumObserved });
  const key = normalize(value);
  const group = summary.groups.find(row => row.key === key);
  if (!group) return null;
  return {
    dimension,
    label: group.label,
    observed: group.observed,
    booked: group.booked,
    bookingRate: group.bookingRate,
    recoveredValue: group.recoveredValue,
    averageBookedValue: group.averageBookedValue,
    basis: "observed-outcomes",
    forecast: false
  };
}

export function rankProposalsByObservedOutcomes(proposals = [], actions = [], { minimumObserved = 3 } = {}) {
  const dimensions = ["strategy", "service", "band", "source"];
  return (Array.isArray(proposals) ? proposals : []).map((proposal, index) => {
    const evidence = dimensions.map(dimension => evidenceFor(proposal, actions, dimension, minimumObserved)).filter(Boolean);
    const strongest = evidence.slice().sort((a, b) => b.observed - a.observed || b.bookingRate - a.bookingRate || b.recoveredValue - a.recoveredValue)[0] || null;
    return {
      proposal,
      originalIndex: index,
      observedEvidence: evidence,
      priorityEvidence: strongest,
      hasObservedEvidence: Boolean(strongest),
      note: strongest ? "Priorità supportata da esiti osservati; non è una previsione di conversione futura." : "Nessun campione osservato sufficiente: ordine originale mantenuto."
    };
  }).sort((a, b) => {
    if (a.hasObservedEvidence !== b.hasObservedEvidence) return a.hasObservedEvidence ? -1 : 1;
    if (!a.priorityEvidence || !b.priorityEvidence) return a.originalIndex - b.originalIndex;
    return b.priorityEvidence.bookingRate - a.priorityEvidence.bookingRate
      || b.priorityEvidence.recoveredValue - a.priorityEvidence.recoveredValue
      || b.priorityEvidence.observed - a.priorityEvidence.observed
      || a.originalIndex - b.originalIndex;
  });
}
