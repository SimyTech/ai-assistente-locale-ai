import test from "node:test";
import assert from "node:assert/strict";
import { createOwnerPullAccelerator } from "../lib/owner-pull-accelerator.js";

function eventTarget() {
  const listeners = new Map();
  return {
    visibilityState: "visible",
    addEventListener(name, handler) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(handler);
    },
    removeEventListener(name, handler) {
      listeners.get(name)?.delete(handler);
    },
    emit(name) {
      for (const handler of listeners.get(name) || []) handler();
    }
  };
}

test("owner-pull adattivo sincronizza al ritorno sulla scheda e quando torna online", async () => {
  const documentRef = eventTarget();
  const windowRef = eventTarget();
  const calls = [];
  const accelerator = createOwnerPullAccelerator({
    pull: force => calls.push(force),
    ready: () => true,
    documentRef,
    windowRef,
    burstIntervalMs: 60000
  });

  accelerator.start();
  documentRef.visibilityState = "hidden";
  documentRef.emit("visibilitychange");
  assert.equal(calls.length, 0);

  documentRef.visibilityState = "visible";
  documentRef.emit("visibilitychange");
  windowRef.emit("online");
  assert.deepEqual(calls, [true, true]);
  accelerator.stop();
});

test("non sincronizza se owner non è pronto o la pagina è nascosta", () => {
  const documentRef = eventTarget();
  const accelerator = createOwnerPullAccelerator({
    pull: () => { throw new Error("non deve essere chiamato"); },
    ready: () => false,
    documentRef,
    windowRef: eventTarget(),
    burstIntervalMs: 60000
  });

  accelerator.start();
  assert.equal(accelerator.trigger(true), false);
  documentRef.visibilityState = "hidden";
  assert.equal(accelerator.trigger(true), false);
  accelerator.stop();
});

test("il throttle evita pull ravvicinati nel burst", () => {
  const originalNow = Date.now;
  let clock = 10000;
  Date.now = () => clock;
  const calls = [];
  const accelerator = createOwnerPullAccelerator({
    pull: () => calls.push(clock),
    ready: () => true,
    documentRef: eventTarget(),
    windowRef: eventTarget(),
    burstIntervalMs: 60000,
    minTriggerGapMs: 1500
  });

  try {
    accelerator.start();
    assert.equal(accelerator.trigger(false), true);
    clock += 500;
    assert.equal(accelerator.trigger(false), false);
    clock += 1000;
    assert.equal(accelerator.trigger(false), true);
    assert.deepEqual(calls, [10000, 11500]);
  } finally {
    accelerator.stop();
    Date.now = originalNow;
  }
});

test("stop disattiva trigger e listener", () => {
  const documentRef = eventTarget();
  const windowRef = eventTarget();
  const calls = [];
  const accelerator = createOwnerPullAccelerator({
    pull: () => calls.push(true),
    ready: () => true,
    documentRef,
    windowRef,
    burstIntervalMs: 60000
  });

  accelerator.start();
  accelerator.stop();
  documentRef.emit("visibilitychange");
  windowRef.emit("online");
  assert.equal(accelerator.trigger(true), false);
  assert.equal(calls.length, 0);
});
