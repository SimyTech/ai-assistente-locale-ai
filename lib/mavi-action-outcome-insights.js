const clean = value => String(value ?? "").trim();
const normalize = value => clean(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
const OBSERVED = new Set(["booked", "no-booking", "declined"]);

function groupKey(action = {}, dimension = "strategy") {
  const proposal = action?.proposal || {};
  if (dimension === "service") return clean(proposal.recommendedService || proposal.service);
  if (dimension === "band") return clean(proposal.targetBand || proposal.preferredBand);
  if (dimension === "source") return clean(proposal.sourceType);
  return clean(proposal.strategy || proposal.sourceType);
}

function finalize(row) {
  const observed = row.observed || 0;
  const booked = row.booked || 0;
  return {
    ...row,
    bookingRate: observed ? booked / observed : 0,
    averageBookedValue: booked ? row.recoveredValue / booked : 0
  };
}

export function summarizeActionOutcomes(actions = [], { dimension = "strategy", minimumObserved = 1 } = {}) {
  const rows = new Map();
  let observed = 0;
  let booked = 0;
  let recoveredValue = 0;

  for (const action of Array.isArray(actions) ? actions : []) {
    const outcome = normalize(action?.outcome);
    if (!OBSERVED.has(outcome)) continue;
    observed += 1;
    if (outcome === "booked") {
      booked += 1;
      const value = Number(action?.outcomeValue);
      if (Number.isFinite(value) && value >= 0) recoveredValue += value;
    }

    const label = groupKey(action, dimension);
    if (!label) continue;
    const key = normalize(label);
    const row = rows.get(key) || { key, label, observed: 0, booked: 0, noBooking: 0, declined: 0, recoveredValue: 0 };
    row.observed += 1;
    if (outcome === "booked") {
      row.booked += 1;
      const value = Number(action?.outcomeValue);
      if (Number.isFinite(value) && value >= 0) row.recoveredValue += value;
    } else if (outcome === "no-booking") row.noBooking += 1;
    else if (outcome === "declined") row.declined += 1;
    rows.set(key, row);
  }

  const groups = [...rows.values()]
    .map(finalize)
    .filter(row => row.observed >= Math.max(1, Number(minimumObserved) || 1))
    .sort((a, b) => b.bookingRate - a.bookingRate || b.recoveredValue - a.recoveredValue || b.observed - a.observed || a.label.localeCompare(b.label));

  return {
    observed,
    booked,
    noBooking: Math.max(0, observed - booked - (Array.isArray(actions) ? actions.filter(action => normalize(action?.outcome) === "declined").length : 0)),
    declined: Array.isArray(actions) ? actions.filter(action => normalize(action?.outcome) === "declined").length : 0,
    recoveredValue,
    bookingRate: observed ? booked / observed : 0,
    averageBookedValue: booked ? recoveredValue / booked : 0,
    dimension,
    groups,
    bestObservedGroup: groups[0] || null,
    note: "Indicatori basati solo su esiti osservati; non sono previsioni di conversione futura."
  };
}
