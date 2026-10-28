/* eslint-disable no-unused-vars */
import * as internals from "./searchScreen.js";

export function createSearchScreenMethods05() {
  const {
    SEARCH_HISTORY_MAX_ITEMS,
    SearchHistoryStore,
    MODERN_HOME_CONSTANTS,
    allowDpadRepeat,
    clamp,
    trimLeadingWhitespace,
    getInputSelectionSnapshot,
    restoreInputSelection
  } = internals;

  return {
    ensureHeaderVisible() {
      const content = this.container?.querySelector(".search-content");
      const header = this.container?.querySelector(".search-header");
      if (!content || !header) return;

      const contentRect = content.getBoundingClientRect();
      const headerRect = header.getBoundingClientRect();
      const topInset = 22;
      const visibleTop = contentRect.top + topInset;

      if (headerRect.top < visibleTop) {
        this.animateScroll(content, "y", content.scrollTop + (headerRect.top - visibleTop), MODERN_HOME_CONSTANTS.cameraFollowDurationYMs, {
          mode: "spring"
        });
      }
    },
    handleSearchDpad(event) {
      const keyCode = Number(event?.keyCode || 0);
      const direction = keyCode === 38 ? "up" : keyCode === 40 ? "down" : keyCode === 37 ? "left" : keyCode === 39 ? "right" : null;
      if (!direction) {
        return false;
      }

      const nav = this.navModel || {};
      const current = this.container?.querySelector(".focusable.focused") || null;
      if (!current) {
        return false;
      }
      const zone = String(current.dataset.navZone || "");

      if (!allowDpadRepeat(this, event, { horizontalMs: 80, verticalMs: 112 })) {
        return true;
      }

      event?.preventDefault?.();

      if (zone === "header") {
        const col = Number(current.dataset.navCol || 0);
        if (direction === "left") {
          if (col > 0) return this.focusNode(current, nav.header?.[col - 1] || current) || true;
          return "sidebar";
        }
        if (direction === "right") {
          if (col < (nav.header?.length || 0) - 1) {
            return this.focusNode(current, nav.header?.[col + 1] || current) || true;
          }
          return true;
        }
        if (direction === "down") {
          const firstRow = nav.rows?.[0] || [];
          const target = current?.id === "searchInput" ? firstRow[0] || null : this.resolvePreferredResultsNode(firstRow, col);
          if (target && current?.id === "searchInput") {
            // Match Android TV: leaving the query field with DPAD_DOWN must dismiss the
            // platform IME before focus moves to the first result row.
            current.blur?.();
            this.rememberCurrentSearchIfValid();
          }
          return this.focusNode(current, target) || true;
        }
        if (direction === "up") {
          return true;
        }
        return true;
      }

      if (zone === "results") {
        const row = Number(current.dataset.navRow || 0);
        const col = Number(current.dataset.navCol || 0);
        const rowNodes = nav.rows?.[row] || [];

        if (direction === "left") {
          if (col > 0) {
            return this.focusNode(current, rowNodes[col - 1] || current) || true;
          }
          return "sidebar";
        }
        if (direction === "right") {
          const target = rowNodes[col + 1] || null;
          return this.focusNode(current, target || current) || true;
        }
        if (direction === "down") {
          const nextRowNodes = nav.rows?.[row + 1] || null;
          if (!nextRowNodes) {
            return true;
          }
          const target = this.resolvePreferredResultsNode(nextRowNodes, col);
          return this.focusNode(current, target) || true;
        }
        if (direction === "up") {
          const prevRowNodes = nav.rows?.[row - 1] || null;
          if (prevRowNodes) {
            const target = this.resolvePreferredResultsNode(prevRowNodes, col);
            return this.focusNode(current, target) || true;
          }
          if (nav.recentClear && row === 0) {
            return this.focusNode(current, nav.recentClear) || true;
          }
          const target = nav.header?.[Math.min(col, (nav.header?.length || 1) - 1)] || nav.header?.[0] || null;
          return this.focusNode(current, target) || true;
        }
        return true;
      }

      if (zone === "recent-clear") {
        if (direction === "down") {
          const target = nav.rows?.[0]?.[0] || null;
          return this.focusNode(current, target) || true;
        }
        if (direction === "up") {
          return this.focusNode(current, nav.header?.[nav.header.length - 1] || null) || true;
        }
        return true;
      }

      return false;
    },
    async runSearchFromInput(input, { autoFocusResults = false, rememberToHistory = false } = {}) {
      const nextQuery = trimLeadingWhitespace(input?.value || "").trim();
      this.query = nextQuery;
      const nextMode = nextQuery.length >= 2 ? "search" : "idle";
      if (autoFocusResults) {
        input?.blur?.();
        this.pendingAutoFocusResults = true;
      }
      if (nextMode === "idle" && this.mode === "idle" && !(this.rows || []).length) {
        const queryChanged = this.lastSubmittedQuery !== nextQuery;
        this.lastSubmittedQuery = nextQuery;
        this.captureLiveViewState();
        if (queryChanged) {
          if (this.shouldPatchResultsWithoutReplacingInput()) {
            this.renderResultsOnly();
          } else {
            this.requestRender();
          }
        }
        return;
      }
      if (this.mode === nextMode && this.lastSubmittedQuery === nextQuery) {
        if (rememberToHistory) {
          this.rememberCurrentSearchIfValid();
        }
        if (autoFocusResults && this.resultsQuery === nextQuery) {
          this.requestRender();
        }
        return;
      }
      this.mode = nextMode;
      this.pendingAutoFocusResults = Boolean(autoFocusResults);
      this.lastSubmittedQuery = nextQuery;
      this.loadToken = (this.loadToken || 0) + 1;
      this.cancelActiveSearchRequests();
      this.captureLiveViewState();
      await this.reloadRows();
      if (rememberToHistory) {
        this.rememberCurrentSearchIfValid();
      }
    },
    rememberCurrentSearchIfValid() {
      const query = String(this.query || "").trim();
      if (query.length < 2 || !Array.isArray(this.rows) || !this.rows.some((row) => Array.isArray(row?.items) && row.items.length > 0)) {
        return false;
      }
      this.recentSearches = SearchHistoryStore.save(query, null, SEARCH_HISTORY_MAX_ITEMS);
      return true;
    },
    async runRecentSearchFromNode(node) {
      const query = String(node?.dataset?.query || "").trim();
      const input = this.container?.querySelector("#searchInput");
      if (!query || !input) {
        return;
      }
      input.value = query;
      this.cancelScheduledInputSearch();
      await this.runSearchFromInput(input, {
        autoFocusResults: true,
        rememberToHistory: true
      });
    },
    clearSearchHistory() {
      this.recentSearches = SearchHistoryStore.clear();
      this.lastContentFocus = null;
      this.requestRender();
    },
    removeRecentSearchFromNode(node) {
      const query = String(node?.dataset?.query || "").trim();
      if (!query) {
        return;
      }
      this.recentSearches = SearchHistoryStore.remove(query);
      this.requestRender();
    },
    scheduleSearchFromInput(input) {
      this.cancelScheduledInputSearch();
      this.pendingAutoFocusResults = false;
      const nextQuery = trimLeadingWhitespace(input?.value || "");
      const selectionSnapshot = getInputSelectionSnapshot(input);
      if (input && input.value !== nextQuery) {
        const removedLeadingChars = String(input.value || "").length - nextQuery.length;
        input.value = nextQuery;
        if (selectionSnapshot) {
          restoreInputSelection(input, {
            ...selectionSnapshot,
            start: Math.max(0, Number(selectionSnapshot.start || 0) - removedLeadingChars),
            end: Math.max(0, Number(selectionSnapshot.end || 0) - removedLeadingChars)
          });
        }
      }
      this.query = nextQuery.trim();
      const delay = this.query.length >= 2 ? 320 : 120;
      this.inputSearchTimer = setTimeout(() => {
        this.inputSearchTimer = null;
        void this.runSearchFromInput(input, { autoFocusResults: false });
      }, delay);
    },
    bindSearchInputEvents() {
      const input = this.container?.querySelector("#searchInput");
      if (!input || input.__boundSearchListeners) return;
      input.__boundSearchListeners = true;

      input.addEventListener("input", (event) => {
        this.query = trimLeadingWhitespace(event.target?.value || "");
        this.scheduleSearchFromInput(input);
      });

      input.addEventListener("focus", () => {
        const current = this.container?.querySelector(".focusable.focused") || null;
        if (current !== input) {
          this.focusNode(current, input);
        }
        const valueLength = String(input.value || "").length;
        try {
          input.setSelectionRange(valueLength, valueLength);
        } catch (_) {}
      });

      input.addEventListener("keydown", async (event) => {
        if (event.keyCode !== 13) return;
        event.preventDefault();
        this.cancelScheduledInputSearch();
        await this.runSearchFromInput(input, {
          autoFocusResults: true,
          rememberToHistory: true
        });
      });
    },
    isSearchInputEditingActive(event = null) {
      const input = this.container?.querySelector("#searchInput");
      if (!input) {
        return false;
      }
      const eventTarget = event?.target || null;
      return (
        document.activeElement === input ||
        eventTarget === input ||
        Boolean(eventTarget?.closest?.("#searchInput")) ||
        input.classList.contains("focused") ||
        this.container?.querySelector(".focusable.focused") === input
      );
    },
    keepSearchInputEditingKey(event, code) {
      const input = this.container?.querySelector("#searchInput");
      const navigationKeys = [35, 36, 37, 39];
      if (!input || navigationKeys.indexOf(code) === -1 || !this.isSearchInputEditingActive(event)) {
        return false;
      }

      // Release left/right once the caret sits at the matching edge of the value
      // (always true for an empty input) so dpad navigation can move focus out
      // of the input, e.g. to the discover/mic buttons.
      const valueLength = String(input.value || "").length;
      const selectionSnapshot = getInputSelectionSnapshot(input);
      const caretStart = selectionSnapshot ? clamp(Number(selectionSnapshot.start || 0), 0, valueLength) : valueLength;
      const caretEnd = selectionSnapshot ? clamp(Number(selectionSnapshot.end || 0), 0, valueLength) : valueLength;
      const hasSelection = caretStart !== caretEnd;
      if (code === 37 && !hasSelection && caretStart <= 0) {
        return false;
      }
      if (code === 39 && !hasSelection && caretEnd >= valueLength) {
        return false;
      }

      if (document.activeElement !== input) {
        const selectionSnapshot = getInputSelectionSnapshot(input);
        input.focus?.();
        if (selectionSnapshot && (code === 37 || code === 39)) {
          const delta = code === 37 ? -1 : 1;
          const nextPosition = clamp(
            Number(selectionSnapshot.end || selectionSnapshot.start || 0) + delta,
            0,
            String(input.value || "").length
          );
          restoreInputSelection(input, {
            ...selectionSnapshot,
            start: nextPosition,
            end: nextPosition
          });
        } else if (selectionSnapshot) {
          restoreInputSelection(input, selectionSnapshot);
        }
        event?.preventDefault?.();
      }
      event?.stopPropagation?.();
      return true;
    },
    bindActionEvents() {
      this.container?.querySelectorAll("[data-action]").forEach((node) => {
        if (node.__boundActionListeners) return;
        node.__boundActionListeners = true;
        if (node.dataset.action === "searchInput") return;
        node.addEventListener("click", () => {
          this.activateActionNode(node);
        });
      });
    }
  };
}
