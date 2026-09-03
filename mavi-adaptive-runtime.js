import { MAVI_MODEL_PREFERENCES, MAVI_MODEL_TIERS, maviFallbackChain, selectMaviModelTier } from "./lib/mavi-model-router.js";
import { buildMaviLocalContext, appendMaviConversation } from "./lib/mavi-local-context.js";
import { installOwnerPullAccelerator } from "./lib/owner-pull-accelerator.js";

const STORAGE_KEY = "MAVIRI_MAVI_MODEL_TIER";
const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";
const LOCAL_DATA_KEYS = ["maviri_app_data_v7", "maviri_app_data_v6", "maviri_app_data_v5", "maviri_app_data_v4", "appData", "appData_backup"];
const pipelines = new Map();
let loading = null;
let conversation = [];

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

function readLocalData() {
  for (const key of LOCAL_DATA_KEYS) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const value = JSON.parse(raw);
      if (value && typeof value === "object") return value;
    } catch {}
  }
  return {};
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

function currentTierLoaded() {
  const tier = current();
  return Boolean(tier?.model && pipelines.has(tier.id));
}

function warmup() {
  if (current().id === "fast" || currentTierLoaded()) return Promise.resolve(null);
  return loadWithFallback().catch(() => null);
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
  const safeContext = JSON.stringify(buildMaviLocalContext(context, readLocalData()));
  const userMessage = String(message || "").slice(0, 2000);
  const messages = [
    {
      role: "system",
      content: `Sei Mavi, assistente italiano di Maviri. Rispondi in modo chiaro, breve e naturale. Usa il contesto locale solo come fonte di fatti sull'attività e non inventare dati mancanti. Non esporre dati personali dei clienti. Non dichiarare mai di avere prenotato, cancellato, spostato o salvato dati: ogni azione operativa deve essere verificata dal Business Engine di Maviri. Se l'utente chiede un'azione operativa, aiutalo a formulare i dettagli necessari senza fingere che sia già stata eseguita. Contesto locale: ${safeContext}. /no_think`
    },
    ...conversation,
    { role: "user", content: userMessage }
  ];
  try {
    const result = await withTimeout(loaded.generator(messages, {
      max_new_tokens: 180,
      do_sample: false,
      repetition_penalty: 1.08
    }), 120000, "Generazione locale: tempo esaurito");
    const answer = generatedText(result);
    status("ready", `${loaded.tier.label} pronto`, loaded.tier);
    if (answer) conversation = appendMaviConversation(conversation, userMessage, answer);
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
  isCurrentReady: currentTierLoaded,
  warmup,
  load: loadWithFallback,
  ask,
  resetConversation() {
    conversation = [];
  },
  setPreference(value) {
    const next = MAVI_MODEL_PREFERENCES.includes(value) ? value : "auto";
    localStorage.setItem(STORAGE_KEY, next);
    loading = null;
    return emit();
  }
});

emit();
installOwnerPullAccelerator();
