import { MediaServerRepository, canResolveMediaServerStream } from "../../../data/mediaserver/mediaServerRepository.js";
import { formatHeroRuntime, formatPlaybackTime } from "../detail/episodeCardMetadata.js";
import { isWatchProgressInProgress } from "../../../domain/model/watchProgress.js";
/* eslint-disable no-unused-vars */
import * as internals from "./streamScreen.js";

export function createStreamScreenMethods07() {
  const {
    DirectDebridResolver,
    WebOsEngineFsResolver,
    Environment,
    WebOsLunaService,
    localizedGenreText,
    WEBOS_NATIVE_PLAYER_APP_IDS,
    clamp,
    isLaunchableExternalMediaUrl,
    isLocalOnlyPlaybackUrl,
    guessMimeTypeFromUrl,
    normalizeType,
    normalizeEpisodeCode,
    t
  } = internals;

  return {
    restoreStreamVirtualScrollPosition(listNode, scrollTop) {
      if (!listNode) {
        return;
      }
      const requestedValue = Number(scrollTop || 0);
      const requested = Number.isFinite(requestedValue) ? Math.max(0, requestedValue) : 0;
      if (listNode.classList?.contains("manual-scroll")) {
        this.applyManualListScroll(listNode, requested);
        return;
      }
      try {
        listNode.scrollTop = requested;
      } catch (_) {
        // Keep the logical value when an older TV engine rejects the assignment.
      }
      const applied = Number(listNode.scrollTop);
      this.listScrollTop = Number.isFinite(applied) ? applied : requested;
      if (Number.isFinite(applied) && Math.abs(applied - requested) > 1 && typeof listNode.scrollTo === "function") {
        try {
          listNode.scrollTo(0, requested);
          const afterScrollTo = Number(listNode.scrollTop);
          if (Number.isFinite(afterScrollTo)) {
            this.listScrollTop = afterScrollTo;
          }
        } catch (_) {
          // Direct scrollTop assignment above remains the safe fallback.
        }
      }
    },
    ensureListItemVisible(listNode, target) {
      if (!listNode || !target) {
        return;
      }
      const viewTop = this.getListScrollTop(listNode);
      let itemTop = Number(target.offsetTop || 0);
      let itemBottom = itemTop + Number(target.offsetHeight || 0);
      if (typeof listNode.getBoundingClientRect === "function" && typeof target.getBoundingClientRect === "function") {
        const listRect = listNode.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        if (listRect && targetRect && Number.isFinite(targetRect.top) && Number.isFinite(listRect.top)) {
          itemTop = viewTop + (targetRect.top - listRect.top);
          itemBottom = viewTop + (targetRect.bottom - listRect.top);
        }
      }
      const viewHeight = Number(listNode.clientHeight || 0);
      if (!viewHeight) {
        return;
      }
      const viewBottom = viewTop + viewHeight;
      const pad = 16;
      if (itemBottom > viewBottom - pad) {
        this.setListScrollTop(listNode, itemBottom - viewHeight + pad);
      } else if (itemTop < viewTop + pad) {
        this.setListScrollTop(listNode, itemTop - pad);
      }
    },
    scheduleFocusedListItemVisibilityCheck(listNode, target) {
      if (!listNode || !target) {
        return;
      }
      if (this.focusedListVisibilityCheckRaf && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(this.focusedListVisibilityCheckRaf);
        this.focusedListVisibilityCheckRaf = 0;
      }
      if (this.focusedListVisibilityCheckTimer) {
        clearTimeout(this.focusedListVisibilityCheckTimer);
        this.focusedListVisibilityCheckTimer = 0;
      }
      const run = () => {
        this.focusedListVisibilityCheckRaf = 0;
        this.focusedListVisibilityCheckTimer = 0;
        const root = document.documentElement || document.body;
        if (!this.container || !root?.contains?.(listNode) || !root?.contains?.(target)) {
          return;
        }
        this.ensureListItemVisible(listNode, target);
        this.requestStreamBadgeHydration();
      };
      if (typeof requestAnimationFrame === "function") {
        this.focusedListVisibilityCheckRaf = requestAnimationFrame(run);
        return;
      }
      this.focusedListVisibilityCheckTimer = setTimeout(run, 0);
    },
    getFocusLists() {
      const listNode = this.container?.querySelector(".stream-route-list") || null;
      if (this.streamFocusDomCache?.listNode === listNode) {
        return this.streamFocusDomCache.value;
      }
      const chips = Array.from(this.container.querySelectorAll(".stream-route-chip.focusable"));
      const rows = this.getCardRows();
      const value = {
        chips,
        rows,
        rowCount: this.streamVirtualized ? this.streamVirtualItems.length : rows.length,
        virtualized: this.streamVirtualized
      };
      this.streamFocusDomCache = { listNode, value };
      return value;
    },
    applyFocus() {
      const { chips, rows, rowCount, virtualized } = this.getFocusLists();
      if (!chips.length && !rowCount) {
        return;
      }
      const zone = this.focusState?.zone || (rowCount ? "card" : "filter");
      const index = Number(this.focusState?.index || 0);
      if (zone === "card" && rowCount) {
        const rowIndex = clamp(Number(this.focusState?.row || 0), 0, rowCount - 1);
        const preferredAction = String(this.focusState?.action || "play");
        if (virtualized && !rows[rowIndex]) {
          this.ensureStreamVirtualRowMounted(rowIndex);
          this.streamFocusDomCache = null;
          const mountedRows = this.getCardRows();
          if (!mountedRows[rowIndex]) {
            this.requestStreamVirtualSync(rowIndex, true);
            return;
          }
          rows[rowIndex] = mountedRows[rowIndex];
        }
        const target = this.resolveCardActionForRow(rows[rowIndex], preferredAction);
        const resolvedAction = target?.dataset?.cardAction || "play";
        this.focusState = { zone: "card", row: rowIndex, action: resolvedAction };
        if (target) {
          this.focusElement(target);
        }
        return;
      }
      this.focusState = { zone: "filter", index: clamp(index, 0, Math.max(0, chips.length - 1)) };
      this.focusList(chips, this.focusState.index);
    },
    restoreScrollPosition() {
      const list = this.container?.querySelector(".stream-route-list");
      if (!list) {
        return;
      }
      this.setListScrollTop(list, Number(this.listScrollTop || 0));
    },
    getHeaderMeta() {
      const isSeries = normalizeType(this.params?.itemType) === "series";
      const title = String(this.params?.itemTitle || this.params?.playerTitle || "Untitled");
      const subtitle = isSeries
        ? String(this.params?.episodeTitle || this.params?.playerSubtitle || "").trim()
        : String(this.params?.itemSubtitle || "").trim();
      const episodeLabel = normalizeEpisodeCode(this.params?.season, this.params?.episode);
      const runtimeMinutes = Number(this.params?.runtime);
      const positionMs = Number(this.params?.resumePositionMs || 0);
      const percent = Number(this.params?.resumeProgressPercent || 0);
      const resume =
        !this.params?.startFromBeginning &&
        isWatchProgressInProgress({ positionMs, progressPercent: percent, durationMs: this.params?.resumeDurationMs });
      const resumeLabel = resume
        ? positionMs > 0
          ? t("stream_resume_from_time", [formatPlaybackTime(positionMs / 1000)])
          : t("stream_resume_from_percent", [Math.floor(percent)])
        : "";
      const detailLine = isSeries
        ? Number.isFinite(runtimeMinutes) && runtimeMinutes > 0
          ? formatHeroRuntime(runtimeMinutes)
          : ""
        : [localizedGenreText(this.params?.genres), String(this.params?.year || "").trim()].filter(Boolean).join(" • ");
      return { isSeries, title, subtitle, episodeLabel, detailLine, resumeLabel };
    },
    async detectWebOsNativePlayerApp() {
      if (!Environment.isWebOS() || !WebOsLunaService.isAvailable()) {
        this.webOsNativePlayerAppId = "";
        return "";
      }
      const requestToken = Number(this.nativePlayerRequestToken || 0) + 1;
      this.nativePlayerRequestToken = requestToken;
      for (const appId of WEBOS_NATIVE_PLAYER_APP_IDS) {
        try {
          const payload = await WebOsLunaService.request("luna://com.webos.applicationManager", {
            method: "getAppLoadStatus",
            parameters: { appId }
          });
          if (payload?.exist) {
            if (this.nativePlayerRequestToken === requestToken) {
              this.webOsNativePlayerAppId = appId;
              this.requestRender({ delayMs: 0 });
            }
            return appId;
          }
        } catch (_) {
          // Continue trying known native-player app ids.
        }
      }
      if (this.nativePlayerRequestToken === requestToken) {
        this.webOsNativePlayerAppId = "";
        this.requestRender({ delayMs: 0 });
      }
      return "";
    },
    showStreamToast(message) {
      if (!this.container) {
        return;
      }
      const shell = this.container.querySelector(".stream-route-shell");
      if (!shell) {
        return;
      }
      let toast = shell.querySelector(".stream-route-toast");
      if (!toast) {
        toast = document.createElement("div");
        toast.className = "stream-route-toast";
        shell.appendChild(toast);
      }
      toast.textContent = String(message || "").trim();
      toast.classList.add("visible");
      if (this.streamToastTimer) {
        clearTimeout(this.streamToastTimer);
      }
      this.streamToastTimer = setTimeout(() => {
        toast?.classList.remove("visible");
      }, 2600);
    },
    getStreamRequestHeaders(stream = {}) {
      const raw = stream?.raw || stream || {};
      const requestHeaders = raw?.behaviorHints?.proxyHeaders?.request || stream?.behaviorHints?.proxyHeaders?.request;
      return requestHeaders && typeof requestHeaders === "object" ? { ...requestHeaders } : {};
    },
    resolveStreamMimeType(stream = {}, fallbackUrl = "") {
      const raw = stream?.raw || stream || {};
      const candidates = [stream?.mimeType, raw?.mimeType, stream?.sourceType, raw?.sourceType, raw?.type, raw?.source]
        .map((value) => String(value || "").trim())
        .filter(Boolean);
      const explicit = candidates.find((value) => value.includes("/"));
      if (explicit) {
        return explicit;
      }
      const alias = String(candidates[0] || "").toLowerCase();
      const aliasMap = {
        dash: "application/dash+xml",
        hls: "application/vnd.apple.mpegurl",
        m3u8: "application/vnd.apple.mpegurl",
        m4v: "video/mp4",
        mkv: "video/x-matroska",
        mov: "video/quicktime",
        mp4: "video/mp4",
        mpd: "application/dash+xml",
        ts: "video/mp2t",
        webm: "video/webm"
      };
      return aliasMap[alias] || guessMimeTypeFromUrl(fallbackUrl) || "video/mp4";
    },
    getWebOsNativeLaunchUrl(stream = {}) {
      const requestHeaders = this.getStreamRequestHeaders(stream);
      if (Object.keys(requestHeaders).length) {
        return "";
      }
      const candidates = [
        stream?.engineFs?.publicPlaybackUrl,
        stream?.raw?.engineFs?.publicPlaybackUrl,
        stream?.externalUrl,
        stream?.url,
        stream?.raw?.externalUrl,
        stream?.raw?.url
      ].filter(Boolean);
      return candidates.find((value) => isLaunchableExternalMediaUrl(value) && !isLocalOnlyPlaybackUrl(value)) || "";
    },
    canOfferNativePlayerForStream(stream = {}) {
      if (!Environment.isWebOS() || !this.webOsNativePlayerAppId) {
        return false;
      }
      if (this.getWebOsNativeLaunchUrl(stream)) {
        return true;
      }
      if (canResolveMediaServerStream(stream)) return true;
      if (WebOsEngineFsResolver.canResolveStream(stream)) {
        return true;
      }
      return DirectDebridResolver.canResolveStream(stream, {
        season: this.params?.season ?? null,
        episode: this.params?.episode ?? null
      });
    },
    replaceStreamInList(streamId, nextStream = null) {
      if (!streamId || !nextStream) {
        return;
      }
      this.streams = this.streams.map((stream) => (stream.id === streamId ? { ...stream, ...nextStream } : stream));
    },
    async resolveStreamForNativePlayer(stream = {}) {
      if (canResolveMediaServerStream(stream)) return MediaServerRepository.resolve(stream);
      const directUrl = this.getWebOsNativeLaunchUrl(stream);
      if (directUrl) {
        return { status: "success", stream };
      }
      if (WebOsEngineFsResolver.canResolveStream(stream)) {
        const result = await WebOsEngineFsResolver.resolve(stream, {});
        if (result?.status === "success" && result.stream) {
          return result;
        }
      }
      if (
        DirectDebridResolver.canResolveStream(stream, {
          season: this.params?.season ?? null,
          episode: this.params?.episode ?? null
        })
      ) {
        const result = await DirectDebridResolver.resolve(stream, {
          season: this.params?.season ?? null,
          episode: this.params?.episode ?? null
        });
        if (result?.status === "success" && result.stream) {
          return result;
        }
        return result || { status: "unavailable" };
      }
      return { status: "unavailable" };
    }
  };
}
