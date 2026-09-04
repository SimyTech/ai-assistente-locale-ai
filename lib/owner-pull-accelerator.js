const ACTIVE_WINDOW_MS = 30000;
const BURST_INTERVAL_MS = 3000;
const MIN_TRIGGER_GAP_MS = 1500;

function now() {
  return Date.now();
}

export function createOwnerPullAccelerator({
  pull,
  ready,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  activeWindowMs = ACTIVE_WINDOW_MS,
  burstIntervalMs = BURST_INTERVAL_MS,
  minTriggerGapMs = MIN_TRIGGER_GAP_MS
} = {}) {
  if (typeof pull !== "function" || typeof ready !== "function") {
    return { start() {}, stop() {}, trigger() {} };
  }

  let timer = null;
  let lastActivityAt = now();
  let lastPullAt = 0;
  let stopped = true;

  function visible() {
    return !documentRef || documentRef.visibilityState !== "hidden";
  }

  function active() {
    return now() - lastActivityAt <= activeWindowMs;
  }

  function trigger(force = false) {
    if (stopped || !visible() || !ready()) return false;
    const current = now();
    if (!force && current - lastPullAt < minTriggerGapMs) return false;
    lastPullAt = current;
    Promise.resolve(pull(true)).catch(() => {});
    return true;
  }

  function tick() {
    if (!stopped && active()) trigger(false);
  }

  function markActivity() {
    lastActivityAt = now();
  }

  function onVisibility() {
    if (visible()) {
      markActivity();
      trigger(true);
    }
  }

  function onOnline() {
    markActivity();
    trigger(true);
  }

  function start() {
    if (!stopped) return;
    stopped = false;
    markActivity();
    timer = setInterval(tick, burstIntervalMs);
    documentRef?.addEventListener?.("visibilitychange", onVisibility);
    windowRef?.addEventListener?.("online", onOnline);
    for (const eventName of ["pointerdown", "keydown", "touchstart"]) {
      documentRef?.addEventListener?.(eventName, markActivity, { passive: true });
    }
  }

  function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
    documentRef?.removeEventListener?.("visibilitychange", onVisibility);
    windowRef?.removeEventListener?.("online", onOnline);
    for (const eventName of ["pointerdown", "keydown", "touchstart"]) {
      documentRef?.removeEventListener?.(eventName, markActivity);
    }
  }

  return { start, stop, trigger };
}

export function installOwnerPullAccelerator() {
  if (typeof window === "undefined") return null;
  const pull = window.pullOwnerData;
  const ready = window.ownerReady;
  if (typeof pull !== "function" || typeof ready !== "function") return null;
  if (window.__MAVIRI_OWNER_PULL_ACCELERATOR__) return window.__MAVIRI_OWNER_PULL_ACCELERATOR__;

  const accelerator = createOwnerPullAccelerator({ pull, ready });
  accelerator.start();
  window.__MAVIRI_OWNER_PULL_ACCELERATOR__ = accelerator;
  return accelerator;
}

export function installMobileMoreRightFix(documentRef = globalThis.document) {
  if (!documentRef?.head) return false;
  const id = "maviri-mobile-more-right-fix";
  if (documentRef.getElementById?.(id)) return true;
  const style = documentRef.createElement?.("style");
  if (!style) return false;
  style.id = id;
  style.textContent = "@media(max-width:1000px){.mobile-more{order:999!important}}";
  documentRef.head.appendChild(style);
  return true;
}

installMobileMoreRightFix();
