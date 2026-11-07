/* eslint-disable no-unused-vars */
import * as internals from "./streamScreen.js";
import { focusWithoutScroll } from "../../navigation/focusWithoutScroll.js";
import { startStreamBadgeMarquee, stopStreamBadgeMarquee } from "./streamBadgeMarquee.js";

export function createStreamScreenMethods06() {
  const { ScreenUtils, Environment, isStreamEmptyStateVisible, clamp } = internals;

  return {
    applyAddonFilterDomState(filtered = [], allStreams = []) {
      const list = this.container?.querySelector(".stream-route-list");
      if (!list || !Array.isArray(filtered) || !Array.isArray(allStreams)) {
        return false;
      }

      const targetFilter = String(this.addonFilter || "all");
      // The All tab is defined by the complete stream list. Keep this explicit
      // so a stale filtered cache can never leave All with hidden cards and a
      // misleading empty state.
      const visibleStreams = targetFilter === "all" ? allStreams : filtered;

      const rows = Array.from(list.querySelectorAll(".stream-route-card-row[data-stream-key]"));
      if (rows.length !== allStreams.length) {
        return false;
      }

      const rowsByKey = new Map(rows.map((row) => [String(row.dataset.streamKey || ""), row]));
      const streamIndices = new Map();
      allStreams.forEach((stream, index) => {
        const indices = streamIndices.get(stream) || [];
        indices.push(index);
        streamIndices.set(stream, indices);
      });
      const streamOccurrences = new Map();
      const visibleRows = [];
      for (const stream of visibleStreams) {
        const indices = streamIndices.get(stream) || [];
        const occurrence = Number(streamOccurrences.get(stream) || 0);
        const row = rowsByKey.get(String(indices[occurrence] ?? ""));
        if (!row) {
          return false;
        }
        streamOccurrences.set(stream, occurrence + 1);
        visibleRows.push(row);
      }

      const visibleRowIndexes = new Map(visibleRows.map((row, index) => [row, index]));
      rows.forEach((row) => {
        const rowIndex = visibleRowIndexes.get(row);
        const visible = rowIndex != null;
        row.hidden = !visible;
        row.style.display = visible ? "" : "none";
        row.dataset.streamRow = String(visible ? rowIndex : -1);
        const card = row.querySelector("[data-card-action]");
        if (card) {
          card.hidden = !visible;
          card.style.display = visible ? "" : "none";
          card.dataset.streamRow = String(visible ? rowIndex : -1);
        }
        row.querySelectorAll("[data-lazy-stream-badges]").forEach((placeholder) => {
          placeholder.dataset.streamBadgeRow = String(visible ? rowIndex : -1);
        });
      });

      // Filters are subsequences of allStreams, so keep the existing DOM order.

      this.container?.querySelectorAll(".stream-route-chip[data-addon]").forEach((chip) => {
        const selected = String(chip.dataset.addon || "all") === targetFilter;
        chip.classList.toggle("selected", selected);
        chip.setAttribute("aria-selected", selected ? "true" : "false");
      });

      const loadingRow = list.querySelector("[data-stream-loading-row]");
      if (loadingRow) {
        const visible = this.hasPendingSourceLoads(targetFilter) || (!visibleStreams.length && this.hasPendingSourceLoads("all"));
        loadingRow.hidden = !visible;
        loadingRow.style.display = visible ? "" : "none";
      }
      const emptyState = list.querySelector("[data-stream-empty]");
      if (emptyState) {
        const visible = isStreamEmptyStateVisible({
          filteredStreams: visibleStreams,
          isLoading: this.loading,
          hasPendingSourceLoads: this.hasPendingSourceLoads("all")
        });
        emptyState.hidden = !visible;
        emptyState.style.display = visible ? "" : "none";
      }
      return true;
    },
    applyAddonFilterInPlace({ filterChanged = true } = {}) {
      if (
        !this.renderedStreamListStable ||
        this.renderedStreamListStreams !== this.streams ||
        this.renderedStreamListSourceChips !== this.sourceChips ||
        this.renderFrame ||
        this.renderDelayTimer
      ) {
        return false;
      }
      const allStreams = this.getFilteredStreams("all");
      const filtered = this.getFilteredStreams();
      if (!this.applyAddonFilterDomState(filtered, allStreams)) {
        return false;
      }
      if (!filterChanged) {
        this.streamFocusDomCache = null;
        this.hydrateVisibleStreamBadges();
        this.restoreScrollPosition();
        this.applyFocus();
        return true;
      }
      this.renderedMarkup = null;
      this.streamFocusDomCache = null;
      this.restoreScrollPosition();
      this.hydrateVisibleStreamBadges();
      this.bindAddonLogoFallbacks();
      ScreenUtils.indexFocusables(this.container, ".focusable:not([hidden])");
      this.restoreScrollPosition();
      this.applyFocus();
      this.bindListScrollState();
      return true;
    },
    resolveCardActionForRow(row = null, preferredAction = "play") {
      if (!row) {
        return null;
      }
      if (preferredAction === "native" && row.native) {
        return row.native;
      }
      return row.play || row.native || null;
    },
    getCardRows() {
      const rows = Array.from(this.container?.querySelectorAll(".stream-route-card-row[data-stream-row]:not([hidden])") || [])
        .map((rowNode) => ({
          row: Number(rowNode.dataset.streamRow || 0),
          play: rowNode.querySelector('[data-card-action="play"]'),
          native: rowNode.querySelector('[data-card-action="native"]')
        }))
        .filter((row) => row.play || row.native);
      if (!this.streamVirtualized) {
        return rows;
      }
      const indexedRows = new Array(this.streamVirtualItems?.length || 0);
      rows.forEach((row) => {
        const rowIndex = Number(row.row);
        if (rowIndex >= 0 && rowIndex < indexedRows.length) {
          indexedRows[rowIndex] = row;
        }
      });
      return indexedRows;
    },
    isCardActionFocused(rowIndex, action) {
      return (
        this.focusState?.zone === "card" &&
        Number(this.focusState?.row || 0) === Number(rowIndex) &&
        String(this.focusState?.action || "play") === String(action || "play")
      );
    },
    focusElement(target, { ensureVisible = true } = {}) {
      if (!target) {
        return false;
      }
      // Long source lists used to scan every focusable node on every D-pad
      // press just to clear one class. Keep the active node instead: focus
      // movement now updates only the previous and next cards, matching the
      // bounded work Android gets from LazyColumn focus navigation.
      const previous =
        this.focusedElement && this.container?.contains(this.focusedElement)
          ? this.focusedElement
          : this.container?.querySelector(".focusable.focused");
      if (previous && previous !== target) {
        previous.classList.remove("focused");
        stopStreamBadgeMarquee(previous.closest(".stream-route-card-row"));
      }
      target.classList.add("focused");
      this.focusedElement = target;
      startStreamBadgeMarquee(target.closest(".stream-route-card-row"));
      focusWithoutScroll(target);

      const chipTrack = target.closest(".stream-route-chip-track");
      if (chipTrack) {
        const left = target.offsetLeft;
        const right = left + target.offsetWidth;
        const viewLeft = chipTrack.scrollLeft;
        const viewRight = viewLeft + chipTrack.clientWidth;
        const pad = 24;
        if (right > viewRight - pad) {
          chipTrack.scrollLeft = Math.max(0, right - chipTrack.clientWidth + pad);
        } else if (left < viewLeft + pad) {
          chipTrack.scrollLeft = Math.max(0, left - pad);
        }
      }

      const listNode = target.closest(".stream-route-list");
      if (listNode && ensureVisible) {
        this.ensureListItemVisible(listNode, target);
        this.listScrollTop = this.getListScrollTop(listNode);
        this.scheduleFocusedListItemVisibilityCheck(listNode, target);
      }
      return true;
    },
    focusList(list, index) {
      if (!Array.isArray(list) || !list.length) {
        return false;
      }
      const targetIndex = clamp(index, 0, list.length - 1);
      const target = list[targetIndex];
      if (!target) {
        return false;
      }
      return this.focusElement(target);
    },
    isLegacyWebOsRoute() {
      return Boolean(document.documentElement?.classList?.contains("legacy-webos") || document.body?.classList?.contains("legacy-webos"));
    },
    shouldUseManualListScroll(listNode) {
      // The manual transform path is needed only by legacy webOS, matching the
      // `.legacy-webos` CSS scope and the platform classification in app.js.
      // Modern webOS and Tizen use the native scroller without touching every row.
      if (!listNode || !Environment.isWebOS() || !this.isLegacyWebOsRoute()) {
        return false;
      }
      return Number(listNode.scrollHeight || 0) > Number(listNode.clientHeight || 0);
    },
    getListScrollTop(listNode) {
      if (!listNode) {
        return 0;
      }
      if (listNode.classList?.contains("manual-scroll")) {
        return Number(listNode.dataset?.manualScrollTop || 0);
      }
      return Number(listNode.scrollTop || 0);
    },
    updateManualListScrollTransform(listNode, scrollTop) {
      if (!listNode) {
        return;
      }
      const normalized = Math.max(0, Number(scrollTop || 0));
      const transform = normalized > 0 ? `translateY(${-normalized}px)` : "";
      Array.from(listNode.children || []).forEach((child) => {
        if (child instanceof HTMLElement) {
          child.style.transform = transform;
        }
      });
    },
    applyManualListScroll(listNode, scrollTop) {
      if (!listNode) {
        return;
      }
      const normalized = Math.max(0, Number(scrollTop || 0));
      listNode.classList.add("manual-scroll");
      listNode.dataset.manualScrollTop = String(normalized);
      listNode.style.setProperty("--stream-route-manual-scroll", `${-normalized}px`);
      try {
        listNode.scrollTop = 0;
      } catch (_) {
        // Ignore webOS scrollTop assignment failures; the manual transform is authoritative.
      }
      this.updateManualListScrollTransform(listNode, normalized);
      this.listScrollTop = normalized;
      this.requestStreamVirtualSync();
    },
    setListScrollTop(listNode, nextScrollTop) {
      if (!listNode) {
        return;
      }
      const usesManualScroll = Boolean(listNode.classList?.contains("manual-scroll")) || this.shouldUseManualListScroll(listNode);
      if (usesManualScroll) {
        const maxScrollTop = Math.max(0, Number(listNode.scrollHeight || 0) - Number(listNode.clientHeight || 0));
        this.applyManualListScroll(listNode, clamp(Number(nextScrollTop || 0), 0, maxScrollTop));
        return;
      }

      const isModernWebOsNativeScroll = Environment.isWebOS() && !this.isLegacyWebOsRoute();
      if (!isModernWebOsNativeScroll) {
        const maxScrollTop = Math.max(0, Number(listNode.scrollHeight || 0) - Number(listNode.clientHeight || 0));
        const normalized = clamp(Number(nextScrollTop || 0), 0, maxScrollTop);
        listNode.scrollTop = normalized;
        if (typeof listNode.scrollTo === "function") {
          try {
            listNode.scrollTo(0, normalized);
          } catch (_) {
            listNode.scrollTop = normalized;
          }
        }
        const applied = Number(listNode.scrollTop || 0);
        if (this.isLegacyWebOsRoute() && maxScrollTop > 0 && normalized > 0 && Math.abs(applied - normalized) > 2) {
          this.applyManualListScroll(listNode, normalized);
          return;
        }
        this.listScrollTop = Number(applied || normalized || 0);
        this.requestStreamVirtualSync();
        return;
      }

      // Native scrollers clamp the assignment themselves. Avoid the extra
      // scrollTo call and layout-forcing readback on long modern-TV lists.
      const requestedValue = Number(nextScrollTop || 0);
      const requested = Number.isFinite(requestedValue) ? Math.max(0, requestedValue) : 0;
      listNode.scrollTop = requested;
      this.listScrollTop = requested;
      this.requestStreamVirtualSync();
    }
  };
}
