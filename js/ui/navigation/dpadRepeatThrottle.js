const repeatStateByOwner = new WeakMap();

function directionForKeyCode(keyCode) {
  if (keyCode === 37) return "left";
  if (keyCode === 39) return "right";
  if (keyCode === 38) return "up";
  if (keyCode === 40) return "down";
  return "";
}

/**
 * Keep Smart-TV repeat navigation at the same cadence as Android TV.
 * The first key-down is never delayed; only native repeat key-down events
 * are gated, so focus ordering and edge behavior remain screen-owned.
 */
export function allowDpadRepeat(owner, event, { horizontalMs = 80, verticalMs = 112 } = {}) {
  if (!owner || !event?.repeat) {
    return true;
  }

  const direction = directionForKeyCode(Number(event.keyCode || 0));
  if (!direction) {
    return true;
  }

  const throttleMs = direction === "left" || direction === "right" ? horizontalMs : verticalMs;
  if (!Number.isFinite(throttleMs) || throttleMs <= 0) {
    return true;
  }

  // Tizen fast path: remotes emit hold-repeat every ~50-100ms. The default
  // 80/112ms gates pass nearly every repeat and queue another full focus
  // workload before the previous press finished layout. Back off on
  // constrained runtimes so holds can't pile up backlog jank.
  let effectiveThrottleMs = throttleMs;
  try {
    const body = globalThis?.document?.body?.classList || null;
    const root = globalThis?.document?.documentElement?.classList || null;
    if (body?.contains("performance-constrained") || root?.contains("performance-constrained")) {
      effectiveThrottleMs = Math.max(
        throttleMs,
        direction === "left" || direction === "right" ? 120 : 160
      );
    }
  } catch (_) {}

  const now = Date.now();
  const previous = Number(repeatStateByOwner.get(owner) || 0);
  if (previous > 0 && now - previous < effectiveThrottleMs) {
    event.preventDefault?.();
    return false;
  }

  repeatStateByOwner.set(owner, now);
  return true;
}

export function resetDpadRepeat(owner) {
  if (owner) {
    repeatStateByOwner.delete(owner);
  }
}
