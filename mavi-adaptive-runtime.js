import { MAVI_MODEL_PREFERENCES, MAVI_MODEL_TIERS, maviFallbackChain, selectMaviModelTier } from "./lib/mavi-model-router.js";
import { installOwnerPullAccelerator } from "./lib/owner-pull-accelerator.js";

const STORAGE_KEY = "MAVIRI_MAVI_MODEL_TIER";
const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";
const pipelines = new Map();
let loading = null;

function preference() {
  const saved = localStorage.getItem(STORAGE_KEY) || "auto";
  return MAVI_MODEL_PREFERENCES.includes(saved) ? saved : "auto";
}

function capabilities() {
  return {
    deviceMemory: navigator.deviceMemory || 0,
    hardwareConcurrency: navigator.hardwareConcurrency || 0,
    webgpu: "gpu" in navigator
  };
}

function current() {
  return selectMaviModelTier(capabilities(), preference());
}

function emit() {
  const tier = current();
  window.dispatchEvent(new CustomEvent("mavi-model-change", { detail: { preference: preference(), tier } }));
  return tier;
}

function status(state, detail, tier = current()) {
  window.dispatchEvent(new CustomEvent("mavi-model-status", { detail: { state, detail, tier } }));
}

function withTimeout(promise, milliseconds, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })
  ]).finally(() => clearTimeout(timer));
}

async function loadTier(tier) {
  if (!tier.model) return null;
  if (pipelines.has(tier.id)) return pipelines.get(tier.id);
  status("loading", `Caricamento ${tier.label}…`, tier);
  const { pipeline } = await import(TRANSFORMERS_URL);
  const device = "gpu" in navigator ? "webgpu" : "wasm";
  const dtype = device === "webgpu" ? "q4f16" : "q4";
  const generator = await pipeline("text-generation", tier.model, {
    device,
    dtype,
    progress_callback: progress => status("loading", progress?.status || `Caricamento ${tier.label}…`, tier)
  });
  pipelines.set(tier.id, generator);
  status("ready", `${tier.label} pronto`, tier);
  return generator;
}

async function loadWithFallback() {
  if (loading) return loading;
  loading = (async () => {
    for (const tierId of maviFallbackChain(current().id)) {
      const tier = MAVI_MODEL_TIERS[tierId];
      if (!tier.model) break;
      try {
        const timeout = tier.id === "light" ? 180000 : 300000;
        return { generator: await withTimeout(loadTier(tier), timeout, `${tier.label}: tempo esaurito`), tier };
      } catch (error) {
        status("fallback", `${tier.label} non disponibile, provo il livello inferiore`, tier);
      }
    }
    return null;
  })().finally(() => { loading = null; });
  return loading;
}

function generatedText(result) {
  const value = result?.[0]?.generated_text;
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return String(value.at(-1)?.content || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  return "";
}

async function ask(message, context = {}) {
  const loaded = await loadWithFallback();
  if (!loaded) return null;
  status("thinking", `${loaded.tier.label} sta elaborando…`, loaded.tier);
  const safeContext = JSON.stringify({
    nomeAttivita: context.businessName || "",
    tipoAttivita: context.businessType || ""
  });
  const messages = [
    { role: "system", content: `Sei Mavi, assistente italiano di Maviri. Rispondi in modo chiaro, breve e naturale. Contesto: ${safeContext}. Non dichiarare mai di avere prenotato, cancellato, spostato o salvato dati. Per azioni operative invita l'utente a formulare una richiesta precisa: saranno verificate dal sistema Maviri. /no_think` },
    { role: "user", content: String(message || "").slice(0, 2000) }
  ];
  try {
    const result = await withTimeout(loaded.generator(messages, {
      max_new_tokens: 160,
      do_sample: false,
      repetition_penalty: 1.08
    }), 120000, "Generazione locale: tempo esaurito");
    const answer = generatedText(result);
    status("ready", `${loaded.tier.label} pronto`, loaded.tier);
    return answer || null;
  } catch (error) {
    status("error", "Risposta locale non disponibile", loaded.tier);
    return null;
  }
}

window.MaviModels = Object.freeze({
  tiers: MAVI_MODEL_TIERS,
  getPreference: preference,
  getCurrent: current,
  getFallbackChain: () => maviFallbackChain(current().id),
  load: loadWithFallback,
  ask,
  setPreference(value) {
    const next = MAVI_MODEL_PREFERENCES.includes(value) ? value : "auto";
    localStorage.setItem(STORAGE_KEY, next);
    loading = null;
    return emit();
  }
});

emit();
installOwnerPullAccelerator();
