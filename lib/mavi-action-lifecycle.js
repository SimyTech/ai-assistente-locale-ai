const clean = value => String(value ?? "").trim();

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

export function proposalActionId(proposal = {}) {
  const input = stableProposalKey(proposal);
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `mavi-action-${(hash >>> 0).toString(16).padStart(8, "0")}`;
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
        error: ""
      });
    }
    return actions.get(id);
  }

  function propose(proposal = {}) {
    return { ...ensure(proposal) };
  }

  function edit(previousProposal = {}, nextProposal = {}) {
    const previousId = proposalActionId(previousProposal);
    actions.delete(previousId);
    return { ...ensure(nextProposal), status: "proposed" };
  }

  function approve(proposal = {}, now = Date.now()) {
    const action = ensure(proposal);
    if (["send-requested", "completed"].includes(action.status)) return { ...action };
    action.status = "approved";
    action.proposal = { ...proposal };
    action.approvedAt = now;
    action.failedAt = null;
    action.error = "";
    return { ...action };
  }

  function requestSend(proposal = {}, now = Date.now()) {
    const action = ensure(proposal);
    if (action.status === "send-requested" || action.status === "completed") {
      return { accepted: false, duplicate: true, action: { ...action } };
    }
    if (action.status !== "approved") {
      return { accepted: false, duplicate: false, action: { ...action } };
    }
    action.status = "send-requested";
    action.sendRequestedAt = now;
    return { accepted: true, duplicate: false, action: { ...action } };
  }

  function complete(proposal = {}, now = Date.now()) {
    const action = ensure(proposal);
    if (action.status !== "send-requested") return { accepted: false, action: { ...action } };
    action.status = "completed";
    action.completedAt = now;
    return { accepted: true, action: { ...action } };
  }

  function fail(proposal = {}, error = "", now = Date.now()) {
    const action = ensure(proposal);
    if (action.status !== "send-requested") return { accepted: false, action: { ...action } };
    action.status = "failed";
    action.failedAt = now;
    action.error = clean(error).slice(0, 240);
    return { accepted: true, action: { ...action } };
  }

  function retry(proposal = {}) {
    const action = ensure(proposal);
    if (action.status !== "failed") return { accepted: false, action: { ...action } };
    action.status = "approved";
    action.sendRequestedAt = null;
    action.failedAt = null;
    action.error = "";
    return { accepted: true, action: { ...action } };
  }

  function get(proposal = {}) {
    const action = actions.get(proposalActionId(proposal));
    return action ? { ...action } : null;
  }

  return { propose, edit, approve, requestSend, complete, fail, retry, get, clear() { actions.clear(); } };
}
