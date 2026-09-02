import test from "node:test";
import assert from "node:assert/strict";
import { maviFallbackChain, selectMaviModelTier, shouldUseLocalMavi } from "../lib/mavi-model-router.js";

test("Mavi sceglie un livello prudente in automatico", () => {
  assert.equal(selectMaviModelTier({ deviceMemory: 2, hardwareConcurrency: 2, webgpu: false }).id, "fast");
  assert.equal(selectMaviModelTier({ deviceMemory: 4, hardwareConcurrency: 4, webgpu: false }).id, "light");
  assert.equal(selectMaviModelTier({ deviceMemory: 8, hardwareConcurrency: 8, webgpu: true }).id, "power");
});

test("Mavi locale interviene soltanto sul fallback generico del server", () => {
  assert.equal(shouldUseLocalMavi("Posso aiutarti con servizi, prezzi, promozioni, orari, disponibilità e prenotazioni. Dimmi cosa ti serve."), true);
  assert.equal(shouldUseLocalMavi("Oggi hai 3 appuntamenti."), false);
  assert.equal(shouldUseLocalMavi("Confermi la prenotazione?"), false);
});

test("Qwen 8B richiede scelta esplicita e conserva il fallback completo", () => {
  assert.equal(selectMaviModelTier({ deviceMemory: 64, hardwareConcurrency: 32, webgpu: true }).id, "power");
  assert.equal(selectMaviModelTier({}, "ultra").id, "ultra");
  assert.deepEqual(maviFallbackChain("ultra"), ["ultra", "power", "light", "fast"]);
});
