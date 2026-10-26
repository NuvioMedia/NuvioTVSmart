/* eslint-disable no-unused-vars */
import * as internals from "./streamScreen.js";
import { bindCachedBadgeImages } from "../../../core/media/cachedBadgeImages.js";

export function createStreamScreenMethods09() {
  const {
    Router,
    ScreenUtils,
    contentTextDirection,
    DebridSettingsStore,
    StreamBadgeSettingsStore,
    rememberFailedAddonLogo,
    Environment,
    findStreamVirtualIndex,
    STREAM_BADGE_WINDOW_ROWS,
    t,
    isPerformanceConstrainedRuntime,
    escapeHtml,
    renderStreamBadgeContents
  } = internals;

  return {
    render() {
      this.cancelScheduledRender();
      const previousVirtualModel = this.streamVirtualized ? this.streamVirtualModel : null;
      const previousFocusedIndex = Number(this.focusState?.row);
      // New earlier sources replace the initial first result. Once the user
      // navigates (or returns from playback), retain the selected identity.
      const holdFirstResult = this.focusState?.zone === "card" && previousFocusedIndex === 0 && !this.streamUserMovedFocus;
      const previousFocusedKey =
        previousVirtualModel &&
        Number.isInteger(previousFocusedIndex) &&
        previousFocusedIndex >= 0 &&
        previousFocusedIndex < previousVirtualModel.keys.length
          ? previousVirtualModel.keys[previousFocusedIndex]
          : "";
      if (previousVirtualModel && !holdFirstResult && !this.streamVirtualFocusReset && Number(this.listScrollTop || 0) > 0) {
        const previousAnchorIndex = findStreamVirtualIndex(previousVirtualModel.offsets, Number(this.listScrollTop || 0));
        this.streamVirtualPendingAnchor =
          previousAnchorIndex >= 0
            ? {
                key: previousVirtualModel.keys[previousAnchorIndex],
                offsetWithinRow: Number(this.listScrollTop || 0) - Number(previousVirtualModel.offsets[previousAnchorIndex] || 0)
              }
            : null;
      } else {
        this.streamVirtualPendingAnchor = null;
      }
      // Rebuilt markup means the memoised filtered-stream list may be stale.
      this._filteredStreamsCache = null;
      const { isSeries, title, subtitle, episodeLabel, detailLine, resumeLabel } = this.getHeaderMeta();
      const backdrop = this.getBackdropUrl();
      const logo = this.params?.logo || "";
      const shellStableClass = this.hasRenderedStreamRouteShell ? " stable" : "";
      const chips = this.buildSourceChipMarkup();
      const filtered = this.getFilteredStreams();
      const allStreams = this.getFilteredStreams("all");
      const hasPendingForFilter = this.hasPendingSourceLoads();
      // Keep the empty state global: a selected source can be empty while
      // another compatible addon is still resolving and may provide streams.
      const hasPendingForAllSources = this.hasPendingSourceLoads("all");
      const streamBadgesEnabled = DebridSettingsStore.get().streamBadgesEnabled !== false;
      const badgeSettings = StreamBadgeSettingsStore.snapshot();
      const showAddonLogo = badgeSettings.showAddonLogo === true;
      const addonLogosReady = !showAddonLogo || !filtered.length || this.areAddonLogosReady(filtered);
      // Addon logos are presentation-only. Keep the Android-equivalent stream
      // cards interactive while their images warm in the background; the card
      // renderer already has a text fallback for a missing logo.
      const virtualizedStreamList = Boolean(this.shouldUseStreamVirtualization(allStreams) && filtered.length);
      if (virtualizedStreamList && previousFocusedKey && !holdFirstResult && !this.streamVirtualFocusReset) {
        const nextKeys = this.getStreamVirtualKeys(filtered);
        const nextFocusedIndex = nextKeys.indexOf(previousFocusedKey);
        if (nextFocusedIndex >= 0) {
          this.focusState = {
            ...this.focusState,
            zone: "card",
            row: nextFocusedIndex,
            index: nextFocusedIndex
          };
        }
      }
      if (holdFirstResult && !this.streamVirtualFocusReset) this.listScrollTop = 0;
      if (virtualizedStreamList) {
        this.streamVirtualized = true;
      } else if (this.streamVirtualized) {
        this.stopStreamVirtualization();
      }
      const stableStreamList = Boolean(filtered.length && addonLogosReady && allStreams.length && !virtualizedStreamList);

      if (filtered.length && showAddonLogo && !addonLogosReady) {
        this.requestAddonLogoPrerender(filtered);
      }

      let body = "";
      if (virtualizedStreamList) {
        body = this.renderStreamVirtualMarkup(filtered, streamBadgesEnabled, badgeSettings);
        if (hasPendingForFilter) {
          body += this.renderLoadingCards(1);
        }
      } else if (stableStreamList) {
        body = allStreams.map((stream, index) => this.renderStreamCard(stream, index, streamBadgesEnabled, badgeSettings)).join("");
        body += this.renderStableStreamLoadingRow();
        body += this.renderStableStreamEmptyState();
      } else if (filtered.length) {
        body = filtered.map((stream, index) => this.renderStreamCard(stream, index, streamBadgesEnabled, badgeSettings)).join("");
        if (hasPendingForFilter) {
          body += this.renderLoadingCards(1);
        }
      } else if (hasPendingForFilter || hasPendingForAllSources) {
        body = this.renderLoadingCards();
      } else if (this.error) {
        body = `<div class="stream-route-empty stream-route-error"><span aria-hidden="true">⚠</span><p>${escapeHtml(this.error)}</p><div class="stream-route-card-row" data-stream-row="0"><button class="stream-route-retry focusable" data-card-action="play" data-action="refreshStreams" data-stream-row="0">${escapeHtml(t("stream_retry"))}</button></div></div>`;
      } else if (!filtered.length) {
        body = `<div class="stream-route-empty"><p>${escapeHtml(t("sources_no_streams", {}, "No streams found"))}</p><p>${escapeHtml(t("stream_no_streams_hint"))}</p></div>`;
      }

      const routeContent = this.autoResumeUiActive
        ? ""
        : `
            <div class="stream-route-content">
              <section class="stream-route-left">
                <div class="stream-route-left-inner">
                  ${logo ? `<img src="${logo}" class="stream-route-logo" alt="${escapeHtml(title)}" />` : `<h1 class="stream-route-title" dir="${contentTextDirection(title)}">${escapeHtml(title)}</h1>`}
                  ${episodeLabel ? `<div class="stream-route-episode-code" dir="${contentTextDirection(episodeLabel)}">${escapeHtml(episodeLabel)}</div>` : ""}
                  ${subtitle ? `<div class="stream-route-subtitle" dir="${contentTextDirection(subtitle)}">${escapeHtml(subtitle)}</div>` : ""}
                  ${detailLine ? `<div class="stream-route-detail-line${isSeries ? "" : " is-info"}" dir="${contentTextDirection(detailLine)}">${escapeHtml(detailLine)}</div>` : !isSeries && subtitle ? `<div class="stream-route-detail-line" dir="${contentTextDirection(subtitle)}">${escapeHtml(subtitle)}</div>` : ""}
                </div>
              </section>
              <section class="stream-route-right">
                <div class="stream-route-panel-shell">
                  <div class="stream-route-panel-header">
                    ${resumeLabel ? `<div class="stream-route-resume-label">${escapeHtml(resumeLabel)}</div>` : ""}
                    <div class="stream-route-chip-wrap">
                      <div class="stream-route-chip-track">${chips}</div>
                    </div>
                  </div>
                  <div class="stream-route-panel">
                    <div class="stream-route-list">${body}</div>
                  </div>
                </div>
              </section>
            </div>`;

      const nextMarkup = `
          <div class="stream-route-shell${shellStableClass}${hasPendingForAllSources ? " is-loading" : ""}">
            <div class="stream-route-backdrop"${backdrop ? ` style="background-image:url('${String(backdrop).replace(/'/g, "%27")}')"` : ""}></div>
            <div class="stream-route-backdrop-dim"></div>
            <div class="stream-route-left-gradient"></div>
            <div class="stream-route-right-gradient"></div>
            ${routeContent}
            ${this.renderContinueWatchingResumeOverlay()}
            ${this.renderAutoPlayOverlay()}
          </div>
        `;

      // Addon logos and the webOS image proxy each schedule their own render once
      // they resolve, so a settled list is rebuilt several times over. Measured on
      // a 407-source list: three consecutive renders produced byte-identical
      // markup at ~1s each, so two of them were pure parse/layout/paint cost.
      // Keep the exact generated markup. Fixed-width hashes are not sufficient
      // here because stream/addon text is part of the string and collisions could
      // otherwise cause a genuinely changed list to retain stale DOM.
      const shellMounted = Boolean(this.container.querySelector(".stream-route-shell"));
      const markupUnchanged = shellMounted && this.renderedMarkup === nextMarkup;

      if (!markupUnchanged) {
        this.container.innerHTML = nextMarkup;
        this.renderedMarkup = nextMarkup;
        this.streamFocusDomCache = null;
        this.focusedElement = null;
      }

      this.renderedStreamListStable = stableStreamList;
      this.renderedStreamListStreams = this.streams;
      this.renderedStreamListSourceChips = this.sourceChips;
      if (stableStreamList) {
        this.applyAddonFilterDomState(filtered, allStreams);
      }

      this.restoreScrollPosition();
      this.hydrateVisibleStreamBadges();
      this.bindAddonLogoFallbacks();
      const headerLogo = this.container.querySelector(".stream-route-logo");
      if (headerLogo)
        headerLogo.onerror = () => {
          const fallback = document.createElement("h1");
          fallback.className = "stream-route-title";
          fallback.dir = contentTextDirection(title);
          fallback.textContent = title;
          headerLogo.replaceWith(fallback);
        };
      if (headerLogo?.complete && !headerLogo.naturalWidth) headerLogo.onerror();
      ScreenUtils.indexFocusables(this.container, ".focusable:not([hidden])");
      this.restoreScrollPosition();
      this.applyFocus();
      this.bindListScrollState();
      if (virtualizedStreamList) {
        this.requestStreamVirtualMeasure();
        this.requestStreamVirtualSync();
      }
      this.streamVirtualFocusReset = false;
      this.hasRenderedStreamRouteShell = true;
    },
    bindListScrollState() {
      const list = this.container?.querySelector(".stream-route-list");
      if (!list) {
        return;
      }
      // A full innerHTML write used to discard this node along with its listeners.
      // Now that an unchanged render keeps the node alive, re-binding would stack
      // a duplicate scroll handler on every render.
      if (this.boundStreamListNode === list) {
        return;
      }
      this.boundStreamListNode = list;
      list.addEventListener(
        "scroll",
        () => {
          this.listScrollTop = this.getListScrollTop(list);
          this.requestStreamVirtualSync();
          this.requestStreamBadgeHydration();
        },
        { passive: true }
      );
      if (Environment.isWebOS()) {
        list.addEventListener(
          "wheel",
          (event) => {
            const deltaMode = Number(event?.deltaMode || 0);
            const multiplier = deltaMode === 1 ? 40 : deltaMode === 2 ? list.clientHeight : 1;
            const deltaY = Number(event?.deltaY || 0) * multiplier;
            if (!deltaY) {
              return;
            }
            event?.preventDefault?.();
            this.setListScrollTop(list, this.getListScrollTop(list) + deltaY);
            this.requestStreamVirtualSync();
            this.requestStreamBadgeHydration();
          },
          { passive: false }
        );
      }
    },
    requestStreamBadgeHydration() {
      if (!isPerformanceConstrainedRuntime() || Router.getCurrent() !== "stream" || this.streamBadgeHydrationFrame) {
        return;
      }
      this.streamBadgeHydrationFrame = requestAnimationFrame(() => {
        this.streamBadgeHydrationFrame = null;
        this.hydrateVisibleStreamBadges();
      });
    },
    hydrateVisibleStreamBadges() {
      if (!isPerformanceConstrainedRuntime() || Router.getCurrent() !== "stream" || !this.container) {
        return;
      }
      const list = this.container.querySelector(".stream-route-list");
      const placeholders = Array.from(this.container.querySelectorAll("[data-lazy-stream-badges]")).filter((placeholder) => {
        const row = placeholder.closest(".stream-route-card-row");
        return !row || !row.hidden;
      });
      if (!list || !placeholders.length) {
        return;
      }
      const filtered = this.getFilteredStreams();
      const streamBadgesEnabled = DebridSettingsStore.get().streamBadgesEnabled !== false;
      const badgeSettings = StreamBadgeSettingsStore.snapshot();
      const focusedRow = this.focusState?.zone === "card" ? Number(this.focusState?.row || 0) : -1;
      let changed = false;

      // Android's LazyColumn only composes badge images near the viewport. The
      // long-list path now also bounds the card DOM; short lists retain the
      // existing complete markup for pointer and remote navigation. Window by
      // row index around the focus (the focused row is always scrolled into view)
      // instead of measuring every card: per-card geometry reads forced a full
      // list reflow on every focus move on constrained TV browsers.
      const anchorRow = focusedRow >= 0 ? focusedRow : 0;
      const windowStart = anchorRow - STREAM_BADGE_WINDOW_ROWS;
      const windowEnd = anchorRow + STREAM_BADGE_WINDOW_ROWS;
      placeholders.forEach((placeholder) => {
        const rowIndex = Number(placeholder.dataset.streamBadgeRow || -1);
        const shouldHydrate = rowIndex === focusedRow || (rowIndex >= windowStart && rowIndex <= windowEnd);
        const hydrated = placeholder.dataset.badgesHydrated === "true";
        if (shouldHydrate && !hydrated) {
          placeholder.innerHTML = renderStreamBadgeContents(filtered[rowIndex], streamBadgesEnabled, badgeSettings);
          bindCachedBadgeImages(placeholder);
          // webOS already uses the fixed-height lazy badge row. Tizen must drop
          // that placeholder-only class once hydrated so its visible wrapping
          // and card geometry remain byte-for-byte CSS-equivalent to the eager
          // rendering path.
          if (Environment.isTizen()) {
            placeholder.classList.remove("stream-route-card-badges-lazy");
          }
          placeholder.dataset.badgesHydrated = "true";
          changed = true;
          // Keep already-visited Tizen rows hydrated. Removing a wrapped badge row
          // above the viewport could change list geometry and move the focused card.
        } else if (!shouldHydrate && hydrated && !Environment.isTizen()) {
          placeholder.textContent = "";
          placeholder.dataset.badgesHydrated = "false";
          changed = true;
        }
      });
      if (changed) {
        this.requestStreamVirtualMeasure();
      }
    },
    bindAddonLogoFallbacks() {
      bindCachedBadgeImages(this.container);
      this.container?.querySelectorAll(".stream-route-addon-badge img[data-addon-logo]").forEach((node) => {
        if (!(node instanceof HTMLImageElement) || node.dataset.fallbackBound === "true") {
          return;
        }
        node.dataset.fallbackBound = "true";
        const fallback = node.nextElementSibling;
        const applyFallback = () => {
          rememberFailedAddonLogo(node.dataset.addonLogo || node.getAttribute("src") || "");
          node.hidden = true;
          if (fallback instanceof HTMLElement) {
            fallback.hidden = false;
          }
        };
        node.addEventListener("error", applyFallback, { once: true });
      });
    }
  };
}
