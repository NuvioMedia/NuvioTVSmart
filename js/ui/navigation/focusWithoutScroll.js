// Chromium added the `preventScroll` focus option in 64. Samsung Tizen 4 (Chromium 56) and
// Tizen 5.0 (Chromium 63) silently ignore it, so a native focus() still scrolls every scrollable
// ancestor and the viewport to reveal the element on top of the app's own scrollLeft/scrollTop
// positioning: one D-pad move produced two scrolls and a visible jitter (#1250).
//
// This helper feature-detects the option once and, where it is missing, snapshots the scroll
// offsets of the element's scrollable ancestors before focus() and restores any that moved,
// synchronously in the same task, so no frame ever paints the native jump.

const MAX_ANCESTOR_WALK = 256;

// null = not detected yet, true/false once known.
let preventScrollSupport = null;

function toFiniteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

// Engines that implement FocusOptions read the dictionary (and so the getter) before focusing
// anything, which makes a detached probe a safe detector: it never steals focus and never
// scrolls. Engines without FocusOptions ignore the argument entirely and the getter stays
// untouched. Returns null when there is no document to build a probe from.
function detectPreventScrollSupport() {
  if (typeof document === "undefined" || typeof document.createElement !== "function") {
    return null;
  }
  let supported = false;
  try {
    const probe = document.createElement("div");
    if (!probe || typeof probe.focus !== "function") {
      return null;
    }
    probe.focus({
      get preventScroll() {
        supported = true;
        return true;
      }
    });
  } catch (_) {
    return supported ? true : null;
  }
  return supported;
}

function isScrollable(node) {
  return (
    toFiniteNumber(node.scrollWidth, 0) > toFiniteNumber(node.clientWidth, 0) ||
    toFiniteNumber(node.scrollHeight, 0) > toFiniteNumber(node.clientHeight, 0)
  );
}

function viewportScroll(win) {
  return {
    x: toFiniteNumber(win.scrollX, toFiniteNumber(win.pageXOffset, 0)),
    y: toFiniteNumber(win.scrollY, toFiniteNumber(win.pageYOffset, 0))
  };
}

// Only scrollable ancestors can move when the engine reveals the element, so only those are
// recorded. The walk ends naturally at documentElement (its parentElement is null), which also
// covers document.scrollingElement in both standards and quirks mode; the window offsets are
// kept separately because the viewport may scroll through either.
function captureScrollState(element) {
  const ancestors = [];
  let node = element.parentElement || null;
  let steps = 0;
  while (node && steps < MAX_ANCESTOR_WALK) {
    steps += 1;
    if (isScrollable(node)) {
      ancestors.push({ node, top: node.scrollTop, left: node.scrollLeft });
    }
    node = node.parentElement || null;
  }
  const win = typeof window !== "undefined" && window ? window : null;
  const viewport = win && typeof win.scrollTo === "function" ? viewportScroll(win) : null;
  return { ancestors, viewport, win };
}

function restoreElementScroll(node, left, top) {
  // `scroll-behavior: smooth` would animate a plain scrollTop assignment on Chromium 61+, which
  // is exactly the frame this helper exists to avoid; scrollTo({ behavior: "instant" }) bypasses
  // it. Chromium 56 has no Element.scrollTo, so assignment stays as the fallback.
  if (typeof node.scrollTo === "function") {
    try {
      node.scrollTo({ left, top, behavior: "instant" });
      if (node.scrollTop === top && node.scrollLeft === left) {
        return;
      }
    } catch (_) {}
  }
  if (node.scrollTop !== top) {
    node.scrollTop = top;
  }
  if (node.scrollLeft !== left) {
    node.scrollLeft = left;
  }
}

function restoreScrollState(state) {
  for (let index = 0; index < state.ancestors.length; index += 1) {
    const { node, top, left } = state.ancestors[index];
    if (node.scrollTop !== top || node.scrollLeft !== left) {
      restoreElementScroll(node, left, top);
    }
  }
  if (state.viewport) {
    const current = viewportScroll(state.win);
    if (current.x !== state.viewport.x || current.y !== state.viewport.y) {
      state.win.scrollTo(state.viewport.x, state.viewport.y);
    }
  }
}

// Focuses `element` without letting the engine scroll it into view. Extra focus options are
// forwarded where the engine understands them. Never throws; falls back to a plain focus().
export function focusWithoutScroll(element, options = {}) {
  if (!element || typeof element.focus !== "function") {
    return undefined;
  }
  try {
    if (preventScrollSupport === null) {
      preventScrollSupport = detectPreventScrollSupport();
    }
    if (preventScrollSupport === true) {
      return element.focus({ preventScroll: true, ...options });
    }
    const state = captureScrollState(element);
    let result;
    if (preventScrollSupport === false) {
      result = element.focus();
    } else {
      // No document to probe (worker-like or test contexts): detect on this element instead. A
      // supporting engine reads the getter and honours preventScroll exactly like the fast path.
      let supported = false;
      result = element.focus({
        ...options,
        get preventScroll() {
          supported = true;
          return true;
        }
      });
      preventScrollSupport = supported;
      if (supported) {
        return result;
      }
    }
    restoreScrollState(state);
    return result;
  } catch (_) {
    try {
      return element.focus();
    } catch (_) {
      return undefined;
    }
  }
}

export function resetFocusWithoutScrollSupportForTests() {
  preventScrollSupport = null;
}
