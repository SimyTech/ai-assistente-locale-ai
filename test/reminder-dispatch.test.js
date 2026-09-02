import test from "node:test";
import assert from "node:assert/strict";

import {
  reminderStateKey,
  tenantIdFromOwnerDataKey,
  tenantOwnerDataKeys
} from "../lib/reminder-dispatch.js";

test("costruisce chiavi stato promemoria per default e tenant", () => {
  assert.equal(reminderStateKey("default"), "maviri:reminders:state");
  assert.equal(reminderStateKey("salone-rosa"), "maviri:tenant:salone-rosa:reminders:state");
});

test("ricava il tenant dalla chiave owner-data", () => {
  assert.equal(tenantIdFromOwnerDataKey("maviri:owner-data"), "default");
  assert.equal(tenantIdFromOwnerDataKey("maviri:tenant:salone-rosa:owner-data"), "salone-rosa");
});

test("crea chiavi owner-data senza duplicati e normalizza i tenant", () => {
  assert.deepEqual(
    tenantOwnerDataKeys(["default", "Salone_Rosa", "salone-rosa"]),
    ["maviri:owner-data", "maviri:tenant:salone-rosa:owner-data"]
  );
});
