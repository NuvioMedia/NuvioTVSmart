/* eslint-disable no-unused-vars */
import * as internals from "./streamScreen.js";

export function createStreamScreenMethods01() {
  const {
    ScreenUtils,
    DebridSettingsStore,
    StreamBadgeSettingsStore,
    buildStreamVirtualModel,
    getStreamVirtualWindow,
    STREAM_VIRTUALIZATION_DEFAULT_ROW_EXTENT,
    STREAM_VIRTUALIZATION_MIN_WINDOW,
    STREAM_VIRTUALIZATION_OVERSCAN_PX,
    STREAM_VIRTUALIZATION_THRESHOLD,
    streamMergeKey
  } = internals;

  return {
    cancelScheduledRender() {
      if (this.renderDelayTimer) {
        clearTimeout(this.renderDelayTimer);
        this.renderDelayTimer = null;
      }
      if (this.renderFrame) {
        cancelAnimationFrame(this.renderFrame);
        this.renderFrame = null;
      }
      if (this.streamBadgeHydrationFrame) {
        cancelAnimationFrame(this.streamBadgeHydrationFrame);
        this.streamBadgeHydrationFrame = null;
      }
      this.cancelStreamVirtualizationWork();
    },
    cancelStreamVirtualizationWork() {
      if (this.streamVirtualSyncFrame) {
        if (this.streamVirtualSyncFrameType === "timeout") {
          clearTimeout(this.streamVirtualSyncFrame);
        } else if (typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(this.streamVirtualSyncFrame);
        }
        this.streamVirtualSyncFrame = null;
        this.streamVirtualSyncFrameType = "";
      }
      if (this.streamVirtualMeasureFrame) {
        if (this.streamVirtualMeasureFrameType === "timeout") {
          clearTimeout(this.streamVirtualMeasureFrame);
        } else if (typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(this.streamVirtualMeasureFrame);
        }
        this.streamVirtualMeasureFrame = null;
        this.streamVirtualMeasureFrameType = "";
      }
    },
    disconnectStreamVirtualResizeObserver() {
      if (this.streamVirtualResizeObserver) {
        this.streamVirtualResizeObserver.disconnect();
        this.streamVirtualResizeObserver = null;
      }
    },
    stopStreamVirtualization() {
      this.cancelStreamVirtualizationWork();
      this.disconnectStreamVirtualResizeObserver();
      this.streamVirtualized = false;
      this.streamVirtualItems = [];
      this.streamVirtualKeys = [];
      this.streamVirtualKeyCache = null;
      this.streamVirtualModel = null;
      this.streamVirtualWindow = null;
      this.streamVirtualRowGap = null;
      this.streamVirtualPreferredIndex = null;
      this.streamVirtualSyncForce = false;
      this.streamVirtualPendingAnchor = null;
    },
    shouldUseStreamVirtualization(streams = []) {
      // Keep ordinary-sized Tizen lists on the stable eager path. The Android
      // LazyColumn equivalent is still used for genuinely long lists, where a
      // full DOM would make every D-pad layout pass scale with result count.
      return Array.isArray(streams) && streams.length > STREAM_VIRTUALIZATION_THRESHOLD;
    },
    getStreamVirtualKeys(streams = []) {
      if (this.streamVirtualKeyCache?.streams === streams) {
        return this.streamVirtualKeyCache.keys;
      }
      const occurrences = new Map();
      const keys = (streams || []).map((stream, index) => {
        const baseKey = streamMergeKey(stream) || String(stream?.id || stream?.url || stream?.externalUrl || stream?.ytId || index);
        const occurrence = Number(occurrences.get(baseKey) || 0);
        occurrences.set(baseKey, occurrence + 1);
        return `${baseKey}::${occurrence}`;
      });
      this.streamVirtualKeyCache = { streams, keys };
      return keys;
    },
    getStreamVirtualRowGap() {
      if (this.streamVirtualRowGap != null) {
        return Number(this.streamVirtualRowGap);
      }
      const row = this.container?.querySelector?.(".stream-route-card-row[data-stream-row]");
      if (row && typeof getComputedStyle === "function") {
        const marginBottom = Number.parseFloat(getComputedStyle(row).marginBottom || "0");
        if (Number.isFinite(marginBottom) && marginBottom >= 0) {
          this.streamVirtualRowGap = marginBottom;
          return marginBottom;
        }
      }
      this.streamVirtualRowGap = 40;
      return this.streamVirtualRowGap;
    },
    getStreamVirtualModel(streams = this.streamVirtualItems) {
      const keys = this.getStreamVirtualKeys(streams);
      const rowGap = this.getStreamVirtualRowGap();
      const sameKeys =
        Array.isArray(this.streamVirtualKeys) &&
        this.streamVirtualKeys.length === keys.length &&
        this.streamVirtualKeys.every((key, index) => key === keys[index]);
      if (sameKeys && this.streamVirtualModel && Number(this.streamVirtualModel.rowGap || 0) === Number(rowGap || 0)) {
        return this.streamVirtualModel;
      }
      const model = buildStreamVirtualModel(keys, this.streamVirtualHeights, STREAM_VIRTUALIZATION_DEFAULT_ROW_EXTENT, {
        rowGap,
        lastRowGap: 0
      });
      model.rowGap = rowGap;
      model.lastRowGap = 0;
      this.streamVirtualKeys = keys;
      this.streamVirtualModel = model;
      return model;
    },
    getStreamVirtualViewportHeight(listNode = null) {
      const height = Number(listNode?.clientHeight || 0);
      return height > 0 ? height : 720;
    },
    renderStreamVirtualMarkup(streams = [], streamBadgesEnabled = true, badgeSettings = null) {
      this.streamVirtualItems = streams;
      const model = this.getStreamVirtualModel(streams);
      if (this.streamVirtualPendingAnchor) {
        const anchorIndex = model.keys.indexOf(this.streamVirtualPendingAnchor.key);
        if (anchorIndex >= 0) {
          this.listScrollTop = Math.max(
            0,
            Number(model.offsets[anchorIndex] || 0) + Number(this.streamVirtualPendingAnchor.offsetWithinRow || 0)
          );
        }
        this.streamVirtualPendingAnchor = null;
      }
      const listNode = this.container?.querySelector?.(".stream-route-list");
      const preferredValue = Number(this.streamVirtualPreferredIndex);
      const preferredIndex =
        this.streamVirtualPreferredIndex != null && this.streamVirtualPreferredIndex !== "" && Number.isFinite(preferredValue)
          ? preferredValue
          : null;
      this.streamVirtualPreferredIndex = null;
      const virtualWindow = getStreamVirtualWindow(model, {
        scrollTop: Number(this.listScrollTop || 0),
        viewportHeight: this.getStreamVirtualViewportHeight(listNode),
        overscanPx: STREAM_VIRTUALIZATION_OVERSCAN_PX,
        minWindow: STREAM_VIRTUALIZATION_MIN_WINDOW,
        preferredIndex
      });
      this.streamVirtualWindow = virtualWindow;
      const cards = [];
      for (let index = virtualWindow.start; index <= virtualWindow.end; index += 1) {
        cards.push(
          this.renderStreamCard(streams[index], index, streamBadgesEnabled, badgeSettings, {
            streamKey: model.keys[index],
            virtualized: true,
            virtualRowGap: model.rowGap,
            virtualLast: index === streams.length - 1,
            previousStream: streams[index - 1] || null
          })
        );
      }
      return `
          <div class="stream-route-virtual-track" data-stream-virtual-track data-stream-virtual-total="${virtualWindow.totalExtent}">
            <div class="stream-route-virtual-spacer" data-stream-virtual-spacer="top" aria-hidden="true" style="height:${virtualWindow.topSpacer}px"></div>
            <div class="stream-route-virtual-window" data-stream-virtual-window data-stream-virtual-start="${virtualWindow.start}" data-stream-virtual-end="${virtualWindow.end}">${cards.join("")}</div>
            <div class="stream-route-virtual-spacer" data-stream-virtual-spacer="bottom" aria-hidden="true" style="height:${virtualWindow.bottomSpacer}px"></div>
          </div>`;
    },
    requestStreamVirtualSync(preferredIndex = null, force = false) {
      if (!this.streamVirtualized) {
        return;
      }
      const preferredValue = Number(preferredIndex);
      if (preferredIndex != null && preferredIndex !== "" && Number.isFinite(preferredValue)) {
        this.streamVirtualPreferredIndex = preferredValue;
      }
      this.streamVirtualSyncForce = Boolean(this.streamVirtualSyncForce || force);
      if (this.streamVirtualSyncFrame) {
        return;
      }
      const run = () => {
        this.streamVirtualSyncFrame = null;
        this.streamVirtualSyncFrameType = "";
        const targetIndex = this.streamVirtualPreferredIndex;
        const shouldForce = Boolean(this.streamVirtualSyncForce);
        this.streamVirtualPreferredIndex = null;
        this.streamVirtualSyncForce = false;
        this.syncStreamVirtualization(targetIndex, { force: shouldForce });
      };
      if (typeof requestAnimationFrame === "function") {
        this.streamVirtualSyncFrameType = "raf";
        this.streamVirtualSyncFrame = requestAnimationFrame(run);
      } else {
        this.streamVirtualSyncFrameType = "timeout";
        this.streamVirtualSyncFrame = setTimeout(run, 0);
      }
    },
    requestStreamVirtualMeasure() {
      if (!this.streamVirtualized || this.streamVirtualMeasureFrame) {
        return;
      }
      const run = () => {
        this.streamVirtualMeasureFrame = null;
        this.streamVirtualMeasureFrameType = "";
        this.measureStreamVirtualRows();
      };
      if (typeof requestAnimationFrame === "function") {
        this.streamVirtualMeasureFrameType = "raf";
        this.streamVirtualMeasureFrame = requestAnimationFrame(run);
      } else {
        this.streamVirtualMeasureFrameType = "timeout";
        this.streamVirtualMeasureFrame = setTimeout(run, 0);
      }
    },
    observeStreamVirtualRows(windowNode) {
      if (typeof ResizeObserver !== "function" || !windowNode) {
        return;
      }
      if (!this.streamVirtualResizeObserver) {
        this.streamVirtualResizeObserver = new ResizeObserver(() => {
          this.requestStreamVirtualMeasure();
        });
      }
      this.streamVirtualResizeObserver.disconnect();
      windowNode.querySelectorAll(".stream-route-card-row[data-stream-row]").forEach((row) => {
        this.streamVirtualResizeObserver.observe(row);
      });
    },
    getMountedStreamVirtualRow(index) {
      const windowNode = this.container?.querySelector?.("[data-stream-virtual-window]");
      if (!windowNode) {
        return null;
      }
      const expected = String(index);
      return (
        Array.from(windowNode.querySelectorAll(".stream-route-card-row[data-stream-row]")).find(
          (row) => String(row.dataset.streamRow || "") === expected
        ) || null
      );
    },
    syncStreamVirtualization(preferredIndex = null, { force = false } = {}) {
      if (!this.streamVirtualized || !this.container) {
        return false;
      }
      const list = this.container.querySelector(".stream-route-list");
      const track = list?.querySelector?.("[data-stream-virtual-track]");
      const windowNode = track?.querySelector?.("[data-stream-virtual-window]");
      if (!list || !track || !windowNode) {
        return false;
      }
      const streams = this.getFilteredStreams();
      this.streamVirtualItems = streams;
      const model = this.getStreamVirtualModel(streams);
      const previousScrollTop = this.getListScrollTop(list);
      const virtualWindow = getStreamVirtualWindow(model, {
        scrollTop: previousScrollTop,
        viewportHeight: this.getStreamVirtualViewportHeight(list),
        overscanPx: STREAM_VIRTUALIZATION_OVERSCAN_PX,
        minWindow: STREAM_VIRTUALIZATION_MIN_WINDOW,
        preferredIndex
      });
      const previousWindow = this.streamVirtualWindow;
      const sameWindow =
        previousWindow &&
        previousWindow.start === virtualWindow.start &&
        previousWindow.end === virtualWindow.end &&
        Math.abs(previousWindow.topSpacer - virtualWindow.topSpacer) < 0.5 &&
        Math.abs(previousWindow.bottomSpacer - virtualWindow.bottomSpacer) < 0.5;
      if (!force && sameWindow && windowNode.childElementCount) {
        return false;
      }

      const focused = this.focusedElement;
      const restoreFocusedAction = focused && list.contains(focused) ? String(focused.dataset?.cardAction || "play") : "";
      const streamBadgesEnabled = DebridSettingsStore.get().streamBadgesEnabled !== false;
      const badgeSettings = StreamBadgeSettingsStore.snapshot();
      windowNode.innerHTML = Array.from({ length: Math.max(0, virtualWindow.end - virtualWindow.start + 1) }, (_, offset) => {
        const index = virtualWindow.start + offset;
        return this.renderStreamCard(streams[index], index, streamBadgesEnabled, badgeSettings, {
          streamKey: model.keys[index],
          virtualized: true,
          virtualRowGap: model.rowGap,
          virtualLast: index === streams.length - 1,
          previousStream: streams[index - 1] || null
        });
      }).join("");
      const topSpacer = track.querySelector('[data-stream-virtual-spacer="top"]');
      const bottomSpacer = track.querySelector('[data-stream-virtual-spacer="bottom"]');
      if (topSpacer) {
        topSpacer.style.height = `${virtualWindow.topSpacer}px`;
      }
      if (bottomSpacer) {
        bottomSpacer.style.height = `${virtualWindow.bottomSpacer}px`;
      }
      track.dataset.streamVirtualTotal = String(virtualWindow.totalExtent);
      windowNode.dataset.streamVirtualStart = String(virtualWindow.start);
      windowNode.dataset.streamVirtualEnd = String(virtualWindow.end);
      this.streamVirtualWindow = virtualWindow;
      this.streamFocusDomCache = null;
      this.focusedElement = null;
      ScreenUtils.indexFocusables(this.container, ".focusable:not([hidden])");
      this.hydrateVisibleStreamBadges();
      this.bindAddonLogoFallbacks();
      this.observeStreamVirtualRows(windowNode);
      this.requestStreamVirtualMeasure();

      if (restoreFocusedAction) {
        const restoredRow = this.getMountedStreamVirtualRow(this.focusState?.row);
        const target = this.resolveCardActionForRow(restoredRow, restoreFocusedAction);
        if (target) {
          // The logical scroll anchor is restored by the caller after a measured
          // window rebind. Do not run the regular visibility correction here as
          // well, or focus restoration can overwrite that anchor on TV browsers.
          this.focusElement(target, { ensureVisible: false });
        }
      }

      // Rebinding the virtual window replaces the focused DOM subtree. Older TV
      // Chromium builds may apply native scroll anchoring (or focus scrolling)
      // after that replacement and move the list far beyond the logical row.
      // Restore the logical position after focus has been restored so the
      // virtualizer remains an implementation detail, like Android LazyColumn.
      this.restoreStreamVirtualScrollPosition(list, previousScrollTop);
      return true;
    }
  };
}
