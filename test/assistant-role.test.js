import test from "node:test";
import assert from "node:assert/strict";
import { assistantRole, isExplicitOwnerChat } from "../lib/assistant-role.js";

test("riconosce il titolare solo quando owner è dichiarato esplicitamente", () => {
  assert.equal(assistantRole({ role: "owner" }), "owner");
  assert.equal(assistantRole({ mode: "owner" }), "owner");
  assert.equal(isExplicitOwnerChat({ action: "chat", role: "owner" }), true);
  assert.equal(isExplicitOwnerChat({ action: "book", role: "owner" }), false);
});

test("tratta client, customer e public come ruoli cliente", () => {
  for (const role of ["client", "customer", "public"]) {
    assert.equal(assistantRole({ role }), "client");
    assert.equal(isExplicitOwnerChat({ action: "chat", role }), false);
  }
});

test("non promuove ruoli mancanti, errati o sconosciuti a titolare", () => {
  for (const body of [{}, { role: "" }, { role: "proprietario" }, { mode: "cliente" }, { role: "admin" }]) {
    assert.equal(assistantRole(body), "unknown");
    assert.equal(isExplicitOwnerChat({ action: "chat", ...body }), false);
  }
});
