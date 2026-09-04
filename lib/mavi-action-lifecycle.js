const clean = value => String(value ?? "").trim();
const OUTCOMES = new Set(["booked", "no-booking", "declined"]);
const STATUSES = new Set(["proposed", "approved", "send-requested", "completed", "failed"]);
const SNAPSHOT_VERSION = 1;

function stableProposalKey(proposal = {}) {
  return [
    clean(proposal.kind),
    clean(proposal.channel),
    clean(proposal.recipient),
    clean(proposal.recipientName),
    clean(proposal.sourceType),
    clean(proposal.date),
    clean(proposal.start),
    clean(proposal.end),
    clean(proposal.text)
  ].join("|");
}

function cloneAction(action) {
  return action ? { ...action, proposal: { ...(action.proposal || {}) } } : null;
}

function timestamp(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
}

export function proposalActionId(proposal = {}) {
  const input = stableProposalKey(proposal);
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `mavi-action-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function normalizePersistedAction(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const proposal = value.proposal && typeof value.proposal === "object" && !Array.isArray(value.proposal) ? { ...value.proposal } : null;
  if (!proposal) return null;
  const id = proposalActionId(proposal);
  if (clean(value.id) !== id) return null;
  const status = clean(value.status);
  if (!STATUSES.has(status)) return null;
  const outcome = value.outcome == null ? null : clean(value.outcome);
  if (outcome !== null && !OUTCOMES.has(outcome)) return null;
  if (outcome !== null && status !== "completed") return null;
  const numericValue = Number(value.outcomeValue);
  return {
    id,
    status,
    proposal,
    approvedAt: timestamp(value.approvedAt),
    sendRequestedAt: timestamp(value.sendRequestedAt),
    completedAt: timestamp(value.completedAt),
    failedAt: timestamp(value.failedAt),
    outcome,
    outcomeAt: outcome ? timestamp(value.outcomeAt) : null,
    outcomeValue: outcome === "booked" && Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : 0,
    appointmentId: outcome === "booked" ? clean(value.appointmentId).slice(0, 120) : "",
    error: status === "failed" ? clean(value.error).slice(0, 240) : ""
  };
}

export function createActionLifecycle() {
  const actions = new Map();

  function ensure(proposal = {}) {
    const id = proposalActionId(proposal);
    if (!actions.has(id)) {
      actions.set(id, {
        id,
        status: "proposed",
        proposal: { ...proposal },
        approvedAt: null,
        sendRequestedAt: null,
        completedAt: null,
        failedAt: null,
        outcome: null,
        outcomeAt: null,
        outcomeValue: 0,
        appointmentId: "",
        error: ""
      });
    }
    return actions.get(id);
  }

  function propose(proposal = {}) {
    return cloneAction(ensure(proposal));
  }

  function edit(previousProposal = {}, nextProposal = {}) {
    const previousId = proposalActionId(previousProposal);
    actions.delete(previousId);
    return cloneAction(ensure(nextProposal));
  }

  function approve(proposal = {}, now = Date.now()) {
    const action = ensure(proposal);
    if (["send-requested", "completed"].includes(action.status)) return cloneAction(action);
    action.status = "approved";
    action.proposal = { ...proposal };
    action.approvedAt = now;
    action.failedAt = null;
    action.error = "";
    return cloneAction(action);
  }

  function requestSend(proposal = {}, now = Date.now()) {
    const action = ensure(proposal);
    if (action.status === "send-requested" || action.status === "completed") {
      return { accepted: false, duplicate: true, action: cloneAction(action) };
    }
    if (action.status !== "approved") {
      return { accepted: false, duplicate: false, action: cloneAction(action) };
    }
    action.status = "send-requested";
    action.sendRequestedAt = now;
    return { accepted: true, duplicate: false, action: cloneAction(action) };
  }

  function complete(proposal = {}, now = Date.now()) {
    const action = ensure(proposal);
    if (action.status !== "send-requested") return { accepted: false, action: cloneAction(action) };
    action.status = "completed";
    action.completedAt = now;
    return { accepted: true, action: cloneAction(action) };
  }

  function recordOutcome(proposal = {}, outcome = {}, now = Date.now()) {
    const action = ensure(proposal);
    if (action.status !== "completed") return { accepted: false, reason: "action-not-completed", action: cloneAction(action) };
    const type = clean(outcome?.type);
    if (!OUTCOMES.has(type)) return { accepted: false, reason: "invalid-outcome", action: cloneAction(action) };
    const value = Number(outcome?.value);
    action.outcome = type;
    action.outcomeAt = now;
    action.outcomeValue = type === "booked" && Number.isFinite(value) && value >= 0 ? value : 0;
    action.appointmentId = type === "booked" ? clean(outcome?.appointmentId).slice(0, 120) : "";
    return { accepted: true, action: cloneAction(action) };
  }

  function fail(proposal = {}, error = "", now = Date.now()) {
    const action = ensure(proposal);
    if (action.status !== "send-requested") return { accepted: false, action: cloneAction(action) };
    action.status = "failed";
    action.failedAt = now;
    action.error = clean(error).slice(0, 240);
    return { accepted: true, action: cloneAction(action) };
  }

  function retry(proposal = {}) {
    const action = ensure(proposal);
    if (action.status !== "failed") return { accepted: false, action: cloneAction(action) };
    action.status = "approved";
    action.sendRequestedAt = null;
    action.failedAt = null;
    action.error = "";
    return { accepted: true, action: cloneAction(action) };
  }

  function get(proposal = {}) {
    return cloneAction(actions.get(proposalActionId(proposal)));
  }

  function list() {
    return [...actions.values()].map(cloneAction);
  }

  function snapshot() {
    return {
      version: SNAPSHOT_VERSION,
      actions: list()
    };
  }

  function restore(snapshotValue = {}) {
    if (!snapshotValue || typeof snapshotValue !== "object" || Array.isArray(snapshotValue)) return { restored: 0, skipped: 0, accepted: false };
    if (Number(snapshotValue.version) !== SNAPSHOT_VERSION || !Array.isArray(snapshotValue.actions)) {
      return { restored: 0, skipped: 0, accepted: false };
    }
    const restored = new Map();
    let skipped = 0;
    for (const row of snapshotValue.actions) {
      const action = normalizePersistedAction(row);
      if (!action) {
        skipped += 1;
        continue;
      }
      restored.set(action.id, action);
    }
    actions.clear();
    for (const [id, action] of restored) actions.set(id, action);
    return { restored: restored.size, skipped, accepted: true };
  }

  return { propose, edit, approve, requestSend, complete, recordOutcome, fail, retry, get, list, snapshot, restore, clear() { actions.clear(); } };
}
