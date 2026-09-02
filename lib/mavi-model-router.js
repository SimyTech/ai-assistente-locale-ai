export const MAVI_MODEL_TIERS = Object.freeze({
  fast: Object.freeze({ id: "fast", label: "Mavi Fast Core", model: null, minMemoryGb: 0 }),
  light: Object.freeze({ id: "light", label: "Qwen 1.7B", model: "onnx-community/Qwen3-1.7B-ONNX", minMemoryGb: 4 }),
  power: Object.freeze({ id: "power", label: "Qwen 4B", model: "onnx-community/Qwen3-4B-ONNX", minMemoryGb: 8 }),
  ultra: Object.freeze({ id: "ultra", label: "Qwen 8B", model: "onnx-community/Qwen3-8B-ONNX", minMemoryGb: 16 })
});

export const MAVI_MODEL_PREFERENCES = Object.freeze(["auto", "fast", "light", "power", "ultra"]);

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function selectMaviModelTier(capabilities = {}, preference = "auto") {
  if (preference !== "auto" && MAVI_MODEL_TIERS[preference]) return MAVI_MODEL_TIERS[preference];

  const memoryGb = finiteNumber(capabilities.deviceMemory);
  const cores = finiteNumber(capabilities.hardwareConcurrency);
  const webgpu = capabilities.webgpu === true;

  // deviceMemory is deliberately conservative and is capped/absent in several browsers.
  // Ultra therefore remains an explicit choice until a real allocation benchmark succeeds.
  if (webgpu && memoryGb >= 8 && cores >= 8) return MAVI_MODEL_TIERS.power;
  if (memoryGb >= 4 && cores >= 4) return MAVI_MODEL_TIERS.light;
  return MAVI_MODEL_TIERS.fast;
}

export function maviFallbackChain(tierId) {
  if (tierId === "ultra") return ["ultra", "power", "light", "fast"];
  if (tierId === "power") return ["power", "light", "fast"];
  if (tierId === "light") return ["light", "fast"];
  return ["fast"];
}

const GENERIC_SERVER_ANSWERS = [
  "Posso aiutarti con servizi, prezzi, promozioni, orari, disponibilità e prenotazioni. Dimmi cosa ti serve.",
  "Non ho ricevuto una risposta valida da Mavi."
];

export function shouldUseLocalMavi(serverAnswer) {
  return GENERIC_SERVER_ANSWERS.includes(String(serverAnswer || "").trim());
}
