import { answerFastLocalData } from "./lib/mavi-fast-data.js";
import { classifyMaviIntent, MAVI_ROUTE } from "./lib/mavi-semantic-router.js";
import { createMaviOperationalMemory } from "./lib/mavi-operational-memory.js";
import { buildProactiveBrief } from "./lib/mavi-proactive-manager.js";
import { createMaviProactiveActions } from "./lib/mavi-proactive-actions.js";
import { installProactiveActionUi } from "./lib/mavi-proactive-action-ui.js";

const operationalMemory = createMaviOperationalMemory();
const proactiveActions = createMaviProactiveActions();

function localData() {
  for (const key of ["maviri_app_data_v7", "maviri_app_data_v6", "maviri_app_data_v5", "maviri_app_data_v4", "appData", "appData_backup"]) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const value = JSON.parse(raw);
      if (value && typeof value === "object") return value;
    } catch {}
  }
  return {};
}

function conversationId() {
  try {
    return String(window.sessionId || "owner-default");
  } catch {
    return "owner-default";
  }
}

function proactiveStorageKey() {
  const tenant = localStorage.getItem("MAVIRI_TENANT_ID") || "default";
  return `mavi_proactive_brief_seen_v1:${tenant}`;
}

function currentProactiveBrief(options = {}) {
  return buildProactiveBrief(window.data || localData(), options);
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
  } catch {
    return false;
  }
}

async function qwenFirst(message) {
  if (!window.MaviModels || window.MaviModels.getCurrent?.().id === "fast") return null;
  const data = localData();
  const context = {
    businessName: data?.business?.name || "",
    businessType: data?.business?.type || ""
  };
  return Promise.race([
    window.MaviModels.ask(message, context),
    new Promise(resolve => setTimeout(() => resolve(null), 4500))
  ]);
}

function installSemanticRouter() {
  const original = window.maviAnswer;
  if (typeof original !== "function" || original.__MAVI_SEMANTIC_ROUTED__) return false;

  const routed = async function(message) {
    const data = window.data || localData();
    const proactive = proactiveActions.handle(message, currentProactiveBrief({ maxItems: 6 }), data, conversationId());

    if (proactive.handled) {
      if (proactive.proposal) {
        window.dispatchEvent(new CustomEvent("mavi:proactive-action-proposal", {
          detail: {
            proposal: proactive.proposal,
            approvalRequired: proactive.approvalRequired,
            execute: false
          }
        }));
      }
      return proactive.answer;
    }

    const prepared = operationalMemory.prepare(message, data, conversationId());

    if (prepared.handled) return prepared.answer;

    const effectiveMessage = prepared.completed ? prepared.message : message;
    const decision = classifyMaviIntent(effectiveMessage);

    if (decision.route === MAVI_ROUTE.LOCAL_DATA) {
      const fast = answerFastLocalData(effectiveMessage, data);
      if (fast?.handled) return fast.answer;
      return original.call(this, effectiveMessage);
    }

    if (decision.route === MAVI_ROUTE.QWEN) {
      const local = await qwenFirst(effectiveMessage);
      if (local) return local;
      return original.call(this, effectiveMessage);
    }

    return original.call(this, effectiveMessage);
  };

  routed.__MAVI_SEMANTIC_ROUTED__ = true;
  window.maviAnswer = routed;
  return true;
}

window.MaviFastData = Object.freeze({
  answer(message, data) {
    return answerFastLocalData(message, data);
  }
});

window.MaviSemanticRouter = Object.freeze({
  classify: classifyMaviIntent,
  install: installSemanticRouter,
  resetOperationalMemory() {
    operationalMemory.clear(conversationId());
  }
});

window.MaviProactiveManager = Object.freeze({
  getBrief(options) {
    return currentProactiveBrief(options);
  },
  showOnce: showProactiveBriefOnce,
  resetSession() {
    try { sessionStorage.removeItem(proactiveStorageKey()); } catch {}
    proactiveActions.clear(conversationId());
  }
});

installProactiveActionUi();

if (!installSemanticRouter()) {
  queueMicrotask(() => {
    if (!installSemanticRouter()) setTimeout(installSemanticRouter, 0);
  });
}

setTimeout(showProactiveBriefOnce, 2500);
