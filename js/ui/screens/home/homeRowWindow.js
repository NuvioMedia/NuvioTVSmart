// Android TV's LazyColumn composes only the rows near the viewport. The DOM
// Home kept every catalog row laid out, so each frame walked the paint layers
// of ~34 rows: measured on a 2019 Tizen set, ~100 ms of layer-tree work per
// D-pad press with ~1.5 rows on screen. Rows outside the margin keep their box
// height (scroll geometry is unchanged) and drop their children from layout.
export const HOME_ROW_PARKED_CLASS = "home-row-parked";
export const HOME_ROW_WINDOW_SELECTOR = ".home-row-continue, .home-modern-row";
// 150% of the rows viewport on each side keeps about two rows mounted ahead.
const DEFAULT_ROOT_MARGIN = "150% 0px";

export function isHomeRowWindowSupported(scope = globalThis) {
  return (
    typeof scope.IntersectionObserver === "function" && scope.__NUVIO_HOME_ROW_WINDOW__ !== false
  );
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
  scope = globalThis
} = {}) {
  const observed = new Set();
  let observer = null;

  const onEntries = (entries) => {
    const leaving = [];
    const entering = [];
    entries.forEach((entry) => {
      const visible = Boolean(entry.isIntersecting || entry.intersectionRatio > 0);
      (visible ? entering : leaving).push(entry.target);
    });
    // Read every height before the first write so parking costs one layout.
    const parked = leaving
      .filter((section) => section.isConnected && !isParked(section) && !holdsFocus(section))
      .map((section) => [section, Number(section.offsetHeight || 0)])
      .filter(([, height]) => height > 0);
    parked.forEach(([section, height]) => {
      section.style.height = `${height}px`;
      section.classList.add(HOME_ROW_PARKED_CLASS);
    });
    entering.forEach(unpark);
  };

  const connect = () => {
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
      const section = node?.closest?.(HOME_ROW_WINDOW_SELECTOR) || null;
      if (!section) {
        return false;
      }
      const changed = [section.previousElementSibling, section, section.nextElementSibling]
        .map(unpark)
        .some(Boolean);
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
          changed = unpark(section) || changed;
        }
      });
      if (changed) {
        this.refresh();
      }
      return changed;
    },
    unparkAll() {
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
      observer.disconnect();
      connect();
    },
    // Rows stay parked: Home keeps its DOM while another screen is open, and
    // waking 30 rows only to hide them restyled ~1900 elements on the way out.
    destroy() {
      observer?.disconnect();
      observer = null;
      observed.clear();
    }
  };
}
