import { answerFastLocalData } from "./lib/mavi-fast-data.js";
import { answerFastConversation } from "./lib/mavi-fast-conversation.js";
import { answerFastAnalytics } from "./lib/mavi-fast-analytics.js";
import { classifyMaviIntent, MAVI_ROUTE } from "./lib/mavi-semantic-router.js";
import { createMaviOperationalMemory } from "./lib/mavi-operational-memory.js";
import { resolveMaviOperationalContext, shouldUseResolvedOperationalContext, resolveMaviManagerialFollowUp } from "./lib/mavi-local-context.js";
import { buildProactiveBrief } from "./lib/mavi-proactive-manager.js";
import { createMaviProactiveActions } from "./lib/mavi-proactive-actions.js";
import { installProactiveActionUi } from "./lib/mavi-proactive-action-ui.js";
import { channelReadyForProposal, fetchMaviChannelStatus } from "./lib/mavi-channel-status.js";
import { createActionLifecycle } from "./lib/mavi-action-lifecycle.js";
import { requestAuthorizedSend } from "./lib/mavi-authorized-send-client.js";

const operationalMemory = createMaviOperationalMemory();
const proactiveActions = createMaviProactiveActions();
const actionLifecycle = createActionLifecycle();
let channelStatus = { ok: false, channels: {} };

function installResponsiveNavigationGuard() {
  try {
    if (document.getElementById("maviri-responsive-nav-guard")) return;
    const style = document.createElement("style");
    style.id = "maviri-responsive-nav-guard";
    style.textContent = ".nav .mobile-more{display:none}@media(max-width:1000px){.nav .mobile-more{display:flex!important}}";
    document.head.appendChild(style);
  } catch {}
}

function localData() {
  for (const key of ["maviri_app_data_v7", "maviri_app_data_v6", "maviri_app_data_v5", "maviri_app_data_v4", "appData", "appData_backup"]) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try { const value = JSON.parse(raw); if (value && typeof value === "object") return value; } catch {}
  }
  return {};
}
function conversationId() { try { return String(window.sessionId || "owner-default"); } catch { return "owner-default"; } }
function tenantId() { try { return String(localStorage.getItem("MAVIRI_TENANT_ID") || "default"); } catch { return "default"; } }
function proactiveStorageKey() { return `mavi_proactive_brief_seen_v1:${tenantId()}`; }
function currentProactiveBrief(options = {}) { return buildProactiveBrief(window.data || localData(), options); }
function conversationHistory() { try { const history = window.MaviModels?.getConversation?.(); return Array.isArray(history) ? history : []; } catch { return []; } }
function rememberTurn(message, answer) { if (!message || !answer) return; try { window.MaviModels?.remember?.(message, answer); } catch {} }

async function refreshChannelStatus(proposal = null) {
  channelStatus = await fetchMaviChannelStatus(window.fetch?.bind(window));
  if (proposal) window.dispatchEvent(new CustomEvent("mavi:channel-status", { detail: { ready: channelReadyForProposal(proposal, channelStatus), channel: proposal.channel || "" } }));
  return channelStatus;
}

function installActionLifecycleBridge() {
  window.addEventListener("mavi:proactive-action-proposal", event => { if (event.detail?.proposal) actionLifecycle.propose(event.detail.proposal); });
  window.addEventListener("mavi:proactive-action-approved", event => { if (event.detail?.proposal) actionLifecycle.approve(event.detail.proposal); });
  window.addEventListener("mavi:proactive-action-edited", event => { const previous = event.detail?.previousProposal || {}; const proposal = event.detail?.proposal; if (proposal) actionLifecycle.edit(previous, proposal); });
  window.addEventListener("mavi:authorized-send-request", async event => {
    const proposal = event.detail?.proposal; if (!proposal) return;
    const result = actionLifecycle.requestSend(proposal);
    window.dispatchEvent(new CustomEvent("mavi:action-lifecycle", { detail: { action: result.action, accepted: result.accepted, duplicate: result.duplicate } }));
    if (!result.accepted) return;
    const delivery = await requestAuthorizedSend(proposal, { tenantId: tenantId(), fetchImpl: window.fetch?.bind(window) });
    if (delivery.ok) { actionLifecycle.complete(proposal); window.dispatchEvent(new CustomEvent("mavi:authorized-send-complete", { detail: { proposal, delivery } })); }
    else { actionLifecycle.fail(proposal, delivery.error || "delivery-failed"); window.dispatchEvent(new CustomEvent("mavi:authorized-send-failed", { detail: { proposal, error: delivery.error || "delivery-failed" } })); }
  });
  window.addEventListener("mavi:authorized-send-complete", event => { const proposal = event.detail?.proposal; if (proposal && actionLifecycle.get(proposal)?.status === "send-requested") actionLifecycle.complete(proposal); });
  window.addEventListener("mavi:authorized-send-failed", event => { const proposal = event.detail?.proposal; if (proposal && actionLifecycle.get(proposal)?.status === "send-requested") actionLifecycle.fail(proposal, event.detail?.error || ""); });
}

function showProactiveBriefOnce() {
  try {
    if (sessionStorage.getItem(proactiveStorageKey())) return false;
    const brief = currentProactiveBrief({ maxItems: 3 });
    sessionStorage.setItem(proactiveStorageKey(), "1");
    if (!brief.hasAttention || typeof window.addBubble !== "function") return false;
    window.addBubble(brief.text, "mavi");
    window.dispatchEvent(new CustomEvent("mavi:proactive-brief", { detail: brief }));
    return true;
  } catch { return false; }
}

async function qwenFirst(message) {
  const models = window.MaviModels;
  if (!models || models.getCurrent?.().id === "fast") return null;
  if (!models.isCurrentReady?.()) { models.warmup?.(); return null; }
  const data = localData();
  const context = { businessName: data?.business?.name || "", businessType: data?.business?.type || "" };
  return Promise.race([models.ask(message, context), new Promise(resolve => setTimeout(() => resolve(null), 3000))]);
}

function installSemanticRouter() {
  const original = window.maviAnswer;
  if (typeof original !== "function" || original.__MAVI_SEMANTIC_ROUTED__) return false;
  const routed = async function(message) {
    const data = window.data || localData();
    const proactive = proactiveActions.handle(message, currentProactiveBrief({ maxItems: 6 }), data, conversationId());
    if (proactive.handled) {
      if (proactive.proposal) { window.dispatchEvent(new CustomEvent("mavi:proactive-action-proposal", { detail: { proposal: proactive.proposal, approvalRequired: proactive.approvalRequired, execute: false } })); refreshChannelStatus(proactive.proposal); }
      return proactive.answer;
    }
    const prepared = operationalMemory.prepare(message, data, conversationId());
    if (prepared.handled) return prepared.answer;

    let effectiveMessage = prepared.completed ? prepared.message : message;
    if (!prepared.completed) {
      const history = conversationHistory();
      const resolvedContext = resolveMaviOperationalContext(history, message, data);
      if (shouldUseResolvedOperationalContext(message, resolvedContext, data)) effectiveMessage = resolvedContext.enrichedMessage;
      else {
        const managerial = resolveMaviManagerialFollowUp(history, message);
        if (managerial.used) effectiveMessage = managerial.enrichedMessage;
      }
    }

    const analytics = answerFastAnalytics(effectiveMessage, data);
    if (analytics) { rememberTurn(message, analytics); return analytics; }

    const decision = classifyMaviIntent(effectiveMessage);
    if (decision.route === MAVI_ROUTE.LOCAL_DATA) {
      const fast = answerFastLocalData(effectiveMessage, data);
      if (fast?.handled) { rememberTurn(message, fast.answer); return fast.answer; }
      const answer = await original.call(this, effectiveMessage); rememberTurn(message, answer); return answer;
    }
    if (decision.route === MAVI_ROUTE.QWEN) {
      const local = await qwenFirst(effectiveMessage); if (local) return local;
      const fastConversation = answerFastConversation(effectiveMessage, data);
      if (fastConversation.handled) { rememberTurn(message, fastConversation.answer); return fastConversation.answer; }
      const answer = await original.call(this, effectiveMessage); rememberTurn(message, answer); return answer;
    }
    return original.call(this, effectiveMessage);
  };
  routed.__MAVI_SEMANTIC_ROUTED__ = true;
  window.maviAnswer = routed;
  return true;
}

window.MaviFastData = Object.freeze({ answer(message, data) { return answerFastLocalData(message, data); } });
window.MaviFastConversation = Object.freeze({ answer(message, data) { return answerFastConversation(message, data); } });
window.MaviSemanticRouter = Object.freeze({ classify: classifyMaviIntent, install: installSemanticRouter, resetOperationalMemory() { operationalMemory.clear(conversationId()); } });
window.MaviProactiveManager = Object.freeze({ getBrief(options) { return currentProactiveBrief(options); }, showOnce: showProactiveBriefOnce, resetSession() { try { sessionStorage.removeItem(proactiveStorageKey()); } catch {} proactiveActions.clear(conversationId()); actionLifecycle.clear(); } });
window.MaviAuthorizedSend = Object.freeze({ canSend(proposal) { return channelReadyForProposal(proposal, channelStatus); }, async refresh(proposal) { await refreshChannelStatus(proposal); return channelReadyForProposal(proposal, channelStatus); }, state(proposal) { return actionLifecycle.get(proposal); }, retry(proposal) { return actionLifecycle.retry(proposal); } });

installResponsiveNavigationGuard();
installActionLifecycleBridge();
installProactiveActionUi();
refreshChannelStatus();
if (!installSemanticRouter()) queueMicrotask(() => { if (!installSemanticRouter()) setTimeout(installSemanticRouter, 0); });
setTimeout(showProactiveBriefOnce, 2500);
