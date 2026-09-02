import { answerFastLocalData } from "./lib/mavi-fast-data.js";
import { classifyMaviIntent, MAVI_ROUTE } from "./lib/mavi-semantic-router.js";
import { createMaviOperationalMemory } from "./lib/mavi-operational-memory.js";

const operationalMemory = createMaviOperationalMemory();

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

if (!installSemanticRouter()) {
  queueMicrotask(() => {
    if (!installSemanticRouter()) setTimeout(installSemanticRouter, 0);
  });
}
