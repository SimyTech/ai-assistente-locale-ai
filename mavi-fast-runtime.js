import { answerFastLocalData } from "./lib/mavi-fast-data.js";
import { classifyMaviIntent, MAVI_ROUTE } from "./lib/mavi-semantic-router.js";

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
    const decision = classifyMaviIntent(message);

    if (decision.route === MAVI_ROUTE.LOCAL_DATA) {
      const fast = answerFastLocalData(message, window.data || localData());
      if (fast?.handled) return fast.answer;
      return original.apply(this, arguments);
    }

    if (decision.route === MAVI_ROUTE.QWEN) {
      const local = await qwenFirst(message);
      if (local) return local;
      return original.apply(this, arguments);
    }

    return original.apply(this, arguments);
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
  install: installSemanticRouter
});

if (!installSemanticRouter()) {
  queueMicrotask(() => {
    if (!installSemanticRouter()) setTimeout(installSemanticRouter, 0);
  });
}
