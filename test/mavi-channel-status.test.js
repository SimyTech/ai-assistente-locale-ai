import test from "node:test";
import assert from "node:assert/strict";
import { channelForProposal, channelReadyForProposal, fetchMaviChannelStatus } from "../lib/mavi-channel-status.js";

test("riconosce solo canali autorizzati", () => {
  assert.equal(channelForProposal({ channel: "whatsapp" }), "whatsapp");
  assert.equal(channelForProposal({ channel: "email" }), "email");
  assert.equal(channelForProposal({ channel: "social" }), "");
});

test("abilita una proposta solo se il suo canale risulta ready", () => {
  const status = { channels: { whatsapp: { ready: true }, email: { ready: false } } };
  assert.equal(channelReadyForProposal({ channel: "whatsapp" }, status), true);
  assert.equal(channelReadyForProposal({ channel: "email" }, status), false);
  assert.equal(channelReadyForProposal({ channel: "social" }, status), false);
});

test("fetch status fallisce in modo conservativo", async () => {
  const failed = await fetchMaviChannelStatus(async () => { throw new Error("offline"); });
  assert.deepEqual(failed, { ok: false, channels: {} });
});

test("fetch status accetta solo risposta valida", async () => {
  const valid = await fetchMaviChannelStatus(async () => ({ ok: true, json: async () => ({ ok: true, channels: { whatsapp: { ready: true } } }) }));
  assert.equal(valid.channels.whatsapp.ready, true);
  const invalid = await fetchMaviChannelStatus(async () => ({ ok: true, json: async () => ({ ok: false }) }));
  assert.deepEqual(invalid, { ok: false, channels: {} });
});
