// Android TV's LazyColumn composes only the rows near the viewport. The DOM
// Home kept every catalog row laid out, so each frame walked the paint layers
// of ~34 rows: measured on a 2019 Tizen set, ~100 ms of layer-tree work per
// D-pad press with ~1.5 rows on screen. Rows outside the margin keep their box
// height (scroll geometry is unchanged) and drop their children from layout.
export const HOME_ROW_PARKED_CLASS = "home-row-parked";
export const HOME_ROW_WINDOW_SELECTOR = ".home-row-continue, .home-modern-row";
// Classic and Grid scroll .home-main (Android: LazyColumn / LazyVerticalGrid).
export const HOME_LEGACY_ROW_WINDOW_SELECTOR = ".home-row, .home-grid-section";
// 150% of the rows viewport on each side keeps about two rows mounted ahead so
// vertical D-pad moves rarely force synchronous ensureReady()/refresh() rebuilds.
const DEFAULT_ROOT_MARGIN = "150% 0px";
const DEFERRED_SCROLL_POLL_MS = 80;
const DEFERRED_SCROLL_MAX_WAIT_MS = 650;
const DEFERRED_KEYDOWN_QUIET_MS = 395;

export function isHomeRowWindowSupported(scope = globalThis) {
  return (
    typeof scope.IntersectionObserver === "function" && scope.__NUVIO_HOME_ROW_WINDOW__ !== false
  );
}

// Grid rows are grouped by card index (chunkHomeGridCards), which needs equal
// CSS grid cells; the flex fallback of older engines keeps every row laid out.
export function supportsHomeGridRowWindow(scope = globalThis) {
  return !scope.document?.documentElement?.classList?.contains("no-css-grid");
}

// Without content-visibility (webOS 6 / Chromium 79) a parked track has no
// box and reads scrollLeft as 0, although the engine restores the offset on
// unpark. The offset is kept at parking time for the Home return state.
const PARKED_SCROLL_LEFT = "__nuvioParkedScrollLeft";

export function getHomeTrackScrollLeft(track) {
  const section = track?.closest?.(`.${HOME_ROW_PARKED_CLASS}`);
  return section && Number.isFinite(track[PARKED_SCROLL_LEFT])
    ? track[PARKED_SCROLL_LEFT]
    : Number(track?.scrollLeft || 0);
}

function keepTrackScrollLeft(section) {
  section.querySelectorAll?.(".home-track").forEach((track) => {
    track[PARKED_SCROLL_LEFT] = Number(track.scrollLeft || 0);
  });
}

function isParked(section) {
  return Boolean(section?.classList?.contains(HOME_ROW_PARKED_CLASS));
}

function unpark(section) {
  if (!isParked(section)) {
    return false;
  }
  section.classList.remove(HOME_ROW_PARKED_CLASS);
  section.style.height = "";
  return true;
}

function holdsFocus(section) {
  return Boolean(section?.querySelector?.(".focused"));
}

export function createHomeRowWindow({
  root,
  rootMargin = DEFAULT_ROOT_MARGIN,
  selector = HOME_ROW_WINDOW_SELECTOR,
  scope = globalThis
} = {}) {
  const observed = new Set();
  const deferredEntries = new Map();
  let observer = null;
  let deferredFlushTimer = null;
  let deferredFlushDeadline = 0;
  let lastKeydownAt = 0;
  let keyListenerAttached = false;

  const getNow = () => (typeof scope?.Date?.now === "function" ? scope.Date.now() : Date.now());
  const keyTarget =
    typeof scope?.document?.addEventListener === "function"
      ? scope.document
      : typeof scope?.addEventListener === "function"
        ? scope
        : null;

  const scheduleTimer =
    typeof scope.setTimeout === "function" ? scope.setTimeout.bind(scope) : setTimeout;
  const cancelTimer =
    typeof scope.clearTimeout === "function" ? scope.clearTimeout.bind(scope) : clearTimeout;

  const onKeydown = () => {
    lastKeydownAt = getNow();
  };

  const attachKeyListener = () => {
    if (!keyListenerAttached && keyTarget && typeof keyTarget.addEventListener === "function") {
      keyTarget.addEventListener("keydown", onKeydown, { capture: true, passive: true });
      keyListenerAttached = true;
    }
  };

  const detachKeyListener = () => {
    if (keyListenerAttached && keyTarget && typeof keyTarget.removeEventListener === "function") {
      keyTarget.removeEventListener("keydown", onKeydown, { capture: true });
    }
    keyListenerAttached = false;
  };

  const clearDeferredFlush = () => {
    if (deferredFlushTimer !== null) {
      cancelTimer(deferredFlushTimer);
      deferredFlushTimer = null;
    }
    deferredFlushDeadline = 0;
    deferredEntries.clear();
  };

  const isCameraScrolling = () => Boolean(root?.classList?.contains?.("is-camera-scrolling"));
  const shouldDeferEntries = () =>
    isCameraScrolling() ||
    (lastKeydownAt > 0 && getNow() - lastKeydownAt < DEFERRED_KEYDOWN_QUIET_MS);

  const applyEntries = (entries) => {
    const leaving = [];
    const entering = [];
    entries.forEach((entry) => {
      const visible = Boolean(entry.isIntersecting || entry.intersectionRatio > 0);
      if (visible) {
        entering.push(entry.target);
      } else {
        leaving.push(entry);
      }
    });
    // Read every height before the first write so parking costs one layout;
    // prefer entry.boundingClientRect when supplied by IntersectionObserver.
    const parked = leaving
      .filter((entry) => {
        const section = entry.target;
        return section.isConnected && !isParked(section) && !holdsFocus(section);
      })
      // Fractional height: Grid sections are not whole pixels, and pinning the
      // rounded offsetHeight shifted everything below by up to half a pixel each.
      .map((entry) => {
        const section = entry.target;
        keepTrackScrollLeft(section);
        const entryHeight = Number(entry.boundingClientRect?.height || 0);
        return [
          section,
          entryHeight > 0
            ? entryHeight
            : Number(section.getBoundingClientRect?.().height || section.offsetHeight || 0)
        ];
      })
      .filter(([, height]) => height > 0);
    parked.forEach(([section, height]) => {
      section.style.height = `${height}px`;
      section.classList.add(HOME_ROW_PARKED_CLASS);
    });
    entering.forEach(unpark);
  };

  const scheduleDeferredFlush = () => {
    if (deferredFlushTimer !== null) {
      return;
    }
    if (!deferredFlushDeadline) {
      deferredFlushDeadline = getNow() + DEFERRED_SCROLL_MAX_WAIT_MS;
    }
    const onFlushTimer = () => {
      deferredFlushTimer = null;
      if (!observer) {
        clearDeferredFlush();
        return;
      }
      if (shouldDeferEntries() && getNow() < deferredFlushDeadline) {
        deferredFlushTimer = scheduleTimer(onFlushTimer, DEFERRED_SCROLL_POLL_MS);
        return;
      }
      const queued = Array.from(deferredEntries.values());
      deferredEntries.clear();
      deferredFlushDeadline = 0;
      if (queued.length) {
        applyEntries(queued);
      }
    };
    deferredFlushTimer = scheduleTimer(onFlushTimer, DEFERRED_SCROLL_POLL_MS);
  };

  const onEntries = (entries) => {
    if (!entries?.length) {
      return;
    }
    if (shouldDeferEntries()) {
      entries.forEach((entry) => {
        if (entry?.target) {
          deferredEntries.set(entry.target, entry);
        }
      });
      scheduleDeferredFlush();
      return;
    }
    if (deferredEntries.size) {
      entries.forEach((entry) => {
        if (entry?.target) {
          deferredEntries.set(entry.target, entry);
        }
      });
      const queued = Array.from(deferredEntries.values());
      clearDeferredFlush();
      applyEntries(queued);
      return;
    }
    applyEntries(entries);
  };

  const connect = () => {
    attachKeyListener();
    observer = new scope.IntersectionObserver(onEntries, { root: root || null, rootMargin });
    observed.forEach((section) => observer.observe(section));
  };

  return {
    // Idempotent: called after every navigation-model rebuild.
    observe(sections = []) {
      if (!observer) {
        connect();
      }
      const next = new Set(sections);
      observed.forEach((section) => {
        if (!next.has(section)) {
          observer.unobserve(section);
          observed.delete(section);
          deferredEntries.delete(section);
        }
      });
      next.forEach((section) => {
        if (!observed.has(section)) {
          observed.add(section);
          observer.observe(section);
        }
      });
    },
    // Focus moves and geometry reads must see real boxes in the same task; the
    // observer only reports on the next frame.
    ensureReady(node) {
      const section = node?.closest?.(selector) || null;
      if (!section) {
        return false;
      }
      const targets = [section.previousElementSibling, section, section.nextElementSibling];
      targets.forEach((target) => {
        if (target) {
          deferredEntries.delete(target);
        }
      });
      if (!deferredEntries.size && deferredFlushTimer !== null) {
        clearDeferredFlush();
      }
      const changed = targets.map(unpark).some(Boolean);
      if (changed) {
        this.refresh();
      }
      return changed;
    },
    // Restoring a saved Home position touches the focused row and the rows the
    // user had scrolled sideways; the others can stay parked.
    ensureRowKeysReady(rowKeys = []) {
      const wanted = new Set(rowKeys.map((rowKey) => String(rowKey || "")).filter(Boolean));
      let changed = false;
      observed.forEach((section) => {
        if (wanted.has(String(section.dataset?.rowKey || ""))) {
          deferredEntries.delete(section);
          changed = unpark(section) || changed;
        }
      });
      if (changed) {
        this.refresh();
      }
      return changed;
    },
    unparkAll() {
      clearDeferredFlush();
      let changed = false;
      observed.forEach((section) => {
        changed = unpark(section) || changed;
      });
      if (changed) {
        this.refresh();
      }
      return changed;
    },
    // A row unparked by hand outside the margin gets no further observer entry;
    // reconnecting re-reports every row on the next frame.
    refresh() {
      if (!observer) {
        return;
      }
      clearDeferredFlush();
      observer.disconnect();
      connect();
    },
    // Rows stay parked: Home keeps its DOM while another screen is open, and
    // waking 30 rows only to hide them restyled ~1900 elements on the way out.
    destroy() {
      clearDeferredFlush();
      detachKeyListener();
      lastKeydownAt = 0;
      observer?.disconnect();
      observer = null;
      observed.clear();
    }
  };
}
