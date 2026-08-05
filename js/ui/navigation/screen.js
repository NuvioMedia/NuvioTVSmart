import { LocalStore } from "../../core/storage/localStore.js";

const STRICT_DPAD_GRID_KEY = "strictDpadGridNavigation";

function shouldUseStrictDpadGrid() {
  return Boolean(LocalStore.get(STRICT_DPAD_GRID_KEY, true));
}

export const ScreenUtils = {
  show(container) {
    if (!container) {
      return;
    }
    if (container.style.display !== "block") {
      container.style.display = "block";
    }
  },

  hide(container) {
    if (!container) {
      return;
    }
    if (container.style.display !== "none") {
      container.style.display = "none";
    }
    if (container.childNodes?.length) {
      if (typeof container.replaceChildren === "function") {
        container.replaceChildren();
      } else {
        container.innerHTML = "";
      }
    }
  },

  setInitialFocus(container, selector = ".focusable") {
    const modalOpen = Boolean(globalThis?.document?.body?.classList?.contains("nuvio-modal-open"));
    if (modalOpen) {
      const existingFocused = container?.querySelector?.(".focusable.focused") || null;
      if (existingFocused instanceof HTMLElement && container?.contains(existingFocused)) {
        try {
          existingFocused.focus({ preventScroll: true });
        } catch (_) {
          try {
            existingFocused.focus();
          } catch (_) {}
        }
        return existingFocused;
      }
      return null;
    }
    const existingFocused = container?.querySelector?.(".focusable.focused") || null;
    if (existingFocused instanceof HTMLElement && container?.contains(existingFocused)) {
      try {
        existingFocused.focus({ preventScroll: true });
      } catch (_) {
        try {
          existingFocused.focus();
        } catch (_) {}
      }
      return existingFocused;
    }
    const first = container?.querySelector(selector);
    if (!first) {
      return;
    }
    first.classList.add("focused");
    first.focus();
  },

  moveFocus(container, direction, selector = ".focusable") {
    if (globalThis?.document?.body?.classList?.contains("nuvio-modal-open")) {
      return;
    }
    const list = Array.from(container?.querySelectorAll(selector) || []);
    const current = container?.querySelector(`${selector}.focused`);
    if (!list.length || !current) {
      return;
    }

    const index = Number(current.dataset.index || 0);
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= list.length) {
      return;
    }

    current.classList.remove("focused");
    list[nextIndex].classList.add("focused");
    try {
      list[nextIndex].focus({ preventScroll: true });
    } catch (_) {
      list[nextIndex].focus();
    }
  },

  moveFocusDirectional(container, direction, selector = ".focusable") {
    if (globalThis?.document?.body?.classList?.contains("nuvio-modal-open")) {
      return;
    }
    const list = Array.from(container?.querySelectorAll(selector) || []).filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    if (!list.length) {
      return;
    }

    const current = container?.querySelector(`${selector}.focused`) || list[0];
    if (!current.classList.contains("focused")) {
      list.forEach((node) => node.classList.remove("focused"));
      current.classList.add("focused");
      try {
        current.focus({ preventScroll: true });
      } catch (_) {
        current.focus();
      }
      return;
    }

    const currentRect = current.getBoundingClientRect();
    const cx = currentRect.left + currentRect.width / 2;
    const cy = currentRect.top + currentRect.height / 2;
    const strictDpadGrid = shouldUseStrictDpadGrid();

    const candidates = list
      .filter((node) => node !== current)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const nx = rect.left + rect.width / 2;
        const ny = rect.top + rect.height / 2;
        const dx = nx - cx;
        const dy = ny - cy;
        return { node, rect, dx, dy };
      })
      .filter(({ dx, dy }) => {
        if (direction === "up") return dy < -2;
        if (direction === "down") return dy > 2;
        if (direction === "left") return dx < -2;
        if (direction === "right") return dx > 2;
        return false;
      })
      .map((entry) => {
        const primary =
          direction === "up" || direction === "down" ? Math.abs(entry.dy) : Math.abs(entry.dx);
        const secondary =
          direction === "up" || direction === "down" ? Math.abs(entry.dx) : Math.abs(entry.dy);
        const axisTolerance =
          direction === "up" || direction === "down"
            ? Math.max(currentRect.width * 0.7, entry.rect.width * 0.7, 48)
            : Math.max(currentRect.height * 0.7, entry.rect.height * 0.7, 48);
        const aligned =
          direction === "up" || direction === "down"
            ? secondary <= axisTolerance
            : secondary <= axisTolerance;
        return {
          ...entry,
          aligned,
          score: primary * 1000 + secondary
        };
      });

    let target = null;

    if (direction === "up" || direction === "down") {
      if (strictDpadGrid) {
        const nearestPrimary = candidates.reduce((min, entry) => {
          const primary = Math.abs(entry.dy);
          return Math.min(min, primary);
        }, Number.POSITIVE_INFINITY);
        const rowTolerance = Math.max(currentRect.height * 0.9, 42);
        const nearestRow = candidates.filter((entry) => {
          const primary = Math.abs(entry.dy);
          return primary <= nearestPrimary + rowTolerance;
        });
        const alignedInRow = nearestRow
          .filter((entry) => entry.aligned)
          .sort((left, right) => Math.abs(left.dx) - Math.abs(right.dx));
        const rowSorted = nearestRow.sort((left, right) => {
          const sec = Math.abs(left.dx) - Math.abs(right.dx);
          if (sec !== 0) {
            return sec;
          }
          return Math.abs(left.dy) - Math.abs(right.dy);
        });
        target = alignedInRow[0]?.node || rowSorted[0]?.node || null;
      } else {
        const alignedCandidates = candidates
          .filter((entry) => entry.aligned)
          .sort((left, right) => left.score - right.score);
        const sortedCandidates = candidates.sort((left, right) => left.score - right.score);
        target = alignedCandidates[0]?.node || sortedCandidates[0]?.node || null;
      }
    } else {
      if (strictDpadGrid) {
        const nearestPrimary = candidates.reduce((min, entry) => {
          const primary = Math.abs(entry.dx);
          return Math.min(min, primary);
        }, Number.POSITIVE_INFINITY);
        const columnTolerance = Math.max(currentRect.width * 0.9, 42);
        const nearestColumn = candidates.filter((entry) => {
          const primary = Math.abs(entry.dx);
          return primary <= nearestPrimary + columnTolerance;
        });
        const alignedInColumn = nearestColumn
          .filter((entry) => entry.aligned)
          .sort((left, right) => Math.abs(left.dy) - Math.abs(right.dy));
        const columnSorted = nearestColumn.sort((left, right) => {
          const sec = Math.abs(left.dy) - Math.abs(right.dy);
          if (sec !== 0) {
            return sec;
          }
          return Math.abs(left.dx) - Math.abs(right.dx);
        });
        target = alignedInColumn[0]?.node || columnSorted[0]?.node || null;
      } else {
        const alignedCandidates = candidates
          .filter((entry) => entry.aligned)
          .sort((left, right) => left.score - right.score);
        const sortedCandidates = candidates.sort((left, right) => left.score - right.score);
        target = alignedCandidates[0]?.node || sortedCandidates[0]?.node || null;
      }
    }
    if (!target) {
      return;
    }

    current.classList.remove("focused");
    target.classList.add("focused");
    try {
      target.focus({ preventScroll: true });
    } catch (_) {
      target.focus();
    }
  },

  handleDpadNavigation(event, container, selector = ".focusable") {
    if (globalThis?.document?.body?.classList?.contains("nuvio-modal-open")) {
      return false;
    }
    const code = Number(event?.keyCode || 0);
    const direction =
      code === 38
        ? "up"
        : code === 40
          ? "down"
          : code === 37
            ? "left"
            : code === 39
              ? "right"
              : null;
    if (!direction) {
      return false;
    }
    if (typeof event?.preventDefault === "function") {
      event.preventDefault();
    }
    this.moveFocusDirectional(container, direction, selector);
    return true;
  },

  indexFocusables(container, selector = ".focusable") {
    const list = Array.from(container?.querySelectorAll(selector) || []);
    list.forEach((node, index) => {
      const indexValue = String(index);
      if (node.dataset.index !== indexValue) {
        node.dataset.index = indexValue;
      }
      if (node.tabIndex !== 0) {
        node.tabIndex = 0;
      }
    });
  }
};
