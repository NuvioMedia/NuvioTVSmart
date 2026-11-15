import { expectedEpisodeFilename } from "../../../core/streams/filenameEpisodeMatcher.js";
import { StreamLinkCacheStore, activeStreamLinkProfile } from "../../../data/local/streamLinkCacheStore.js";
import { cachedStreamLinkCandidate } from "../../../core/streams/streamLinkReuse.js";
/* eslint-disable no-unused-vars */
import * as internals from "./streamScreen.js";

export function createStreamScreenMethods05() {
  const {
    Router,
    DirectDebridResolver,
    WebOsEngineFsResolver,
    TizenStreamingServerResolver,
    addonRepository,
    PlayerSettingsStore,
    StreamPreferencesStore,
    selectAutoPlayStream,
    isAutoPlayEffectivelyEnabled,
    buildStreamResumeIdentity,
    t,
    clamp,
    escapeHtml,
    streamMergeKey,
    getStreamHeadline,
    getOrderedFilterNames,
    sortStreamsByAddonOrder
  } = internals;

  return {
    tryResumeCachedStreamLink() {
      const settings = PlayerSettingsStore.get();
      if (
        this.autoResumeAttempted ||
        this.params?.manualSelection ||
        !settings.streamReuseLastLinkEnabled ||
        this.streamLinkCacheProfileId !== activeStreamLinkProfile()
      )
        return false;
      const cached = StreamLinkCacheStore.getValid(
        this.params || {},
        Number(settings.streamReuseLastLinkCacheHours || 24) * 3600000,
        this.streamLinkCacheProfileId
      );
      if (!cached) return false;
      const candidate = cachedStreamLinkCandidate(cached);
      if (
        cached.infoHash &&
        !DirectDebridResolver.canResolveStream(candidate) &&
        !WebOsEngineFsResolver.canResolveStream(candidate) &&
        !TizenStreamingServerResolver.canResolveStream(candidate)
      )
        return false;
      this.autoResumeAttempted = true;
      this.autoPlayAttempted = true;
      this.autoResumeUiActive = true;
      this.streams = [candidate];
      this.addonFilter = "all";
      void this.playStream(candidate.id, { cachedLink: cached, autoSelected: true });
      return true;
    },
    maybeAutoResumeStream({ allLoaded = false } = {}) {
      if (this.autoResumeAttempted || this.params?.manualSelection) {
        return;
      }
      const settings = PlayerSettingsStore.get();
      const reusableStream = settings.streamReuseLastLinkEnabled
        ? StreamPreferencesStore.getValid(
            this.params?.itemId,
            this.params?.videoId || this.params?.itemId,
            Number(settings.streamReuseLastLinkCacheHours || 24) * 60 * 60 * 1000
          )
        : null;
      const progressIdentity = reusableStream ? String(this.params?.resumeStreamIdentity || "").trim() : "";
      const preferredStreamId = String(reusableStream?.streamId || "").trim();
      const canReuseStoredStream = Boolean(this.params?.continueWatchingBackHome && !this.params?.manualSelection && reusableStream);
      const cachedIdentity = canReuseStoredStream ? String(reusableStream?.resumeIdentity || "").trim() : "";
      const canReusePreferredStream = Boolean(canReuseStoredStream && preferredStreamId);
      if (!progressIdentity && !cachedIdentity && !canReusePreferredStream) {
        this.autoResumeUiActive = false;
        return;
      }
      if (!this.streams.length) {
        if (!this.loading) {
          this.autoResumeAttempted = true;
          this.autoResumeUiActive = false;
          this.requestRender({ delayMs: 0 });
        }
        return;
      }
      const identityMatch =
        this.streams.find((stream) => {
          const stableIdentity = buildStreamResumeIdentity(stream);
          return Boolean(
            (cachedIdentity && stableIdentity === cachedIdentity) ||
            (progressIdentity && (stableIdentity === progressIdentity || streamMergeKey(stream) === progressIdentity))
          );
        }) || null;
      // Stream preferences are stored per profile and per video. They are the
      // Web equivalent of Android's local stream-link cache and remain available
      // even when the selected progress source cannot carry stream metadata.
      const match =
        identityMatch || (canReusePreferredStream ? this.streams.find((stream) => String(stream?.id || "") === preferredStreamId) : null);
      if (match?.id) {
        this.autoResumeAttempted = true;
        void this.playStream(match.id, { autoSelected: true });
        return;
      }
      if (!allLoaded && !this.streamSearchCompleted) {
        return;
      }
      // The remembered source is no longer available. Fall back to the normal
      // source panel instead of leaving the direct-resume loading state visible.
      this.autoResumeAttempted = true;
      this.autoResumeUiActive = false;
      this.requestRender({ delayMs: 0 });
    },
    maybeAutoPlayStream({ allLoaded = false } = {}) {
      if (this.autoResumeUiActive || this.autoPlayAttempted || this.autoPlayCountdown) {
        return;
      }
      // Resume already navigated away, or there is nothing to play.
      if (Router.getCurrent() !== "stream" || !this.streams.length) {
        return;
      }
      const settings = PlayerSettingsStore.get();
      if (this.params?.manualSelection) {
        return;
      }
      const savedPreference =
        settings.streamAutoPlayPreferBingeGroupForNextEpisode && settings.streamAutoPlayReuseBingeGroup
          ? StreamPreferencesStore.getLatestForContent(this.params?.itemId)
          : null;
      const preferredBingeGroup = String(savedPreference?.bingeGroup || "").trim();
      // Android may reuse a remembered group before the search timeout, including
      // MANUAL mode. An explicit manualSelection route above always wins.
      const autoPlayMode = String(settings.streamAutoPlayMode || "MANUAL").toUpperCase();
      if ((autoPlayMode === "MANUAL" && !preferredBingeGroup) || !isAutoPlayEffectivelyEnabled(settings)) return;
      if (!allLoaded && !this.autoPlaySelectionReady && !preferredBingeGroup) return;
      const installedAddonNames = new Set(
        (addonRepository.getCachedInstalledAddons() || [])
          .map((addon) => String(addon?.displayName || addon?.name || "").trim())
          .filter(Boolean)
      );
      const selected = selectAutoPlayStream(
        this.getFilteredStreams().filter((stream) => !stream.partyShared),
        {
          mode: settings.streamAutoPlayMode,
          source: settings.streamAutoPlaySource,
          regexPattern: settings.streamAutoPlayRegex,
          installedAddonNames,
          selectedAddons: settings.streamAutoPlaySelectedAddons,
          selectedPlugins: settings.streamAutoPlaySelectedPlugins,
          preferredBingeGroup,
          preferredFilename: expectedEpisodeFilename(savedPreference?.filename, this.params?.season, this.params?.episode ?? 0),
          preferredInfoHash: savedPreference?.infoHash,
          preferBingeGroupInSelection: Boolean(preferredBingeGroup)
        }
      );
      if (!selected?.id) {
        if (allLoaded) {
          this.autoPlayAttempted = true;
        }
        return;
      }
      this.autoPlayAttempted = true;
      this.cancelAutoPlaySelectionWait();
      void this.playStream(selected.id, { autoSelected: true });
    },
    cancelAutoPlaySelectionWait() {
      if (this.autoPlaySelectionWaitTimer) {
        clearTimeout(this.autoPlaySelectionWaitTimer);
        this.autoPlaySelectionWaitTimer = null;
      }
    },
    startAutoPlayCountdown(stream, seconds) {
      this.cancelAutoPlayCountdown();
      // Focus the chosen stream so cancelling leaves the user on it.
      const visible = this.getFilteredStreams();
      const idx = visible.findIndex((entry) => String(entry?.id || "") === String(stream.id || ""));
      if (idx >= 0) {
        this.focusState = { zone: "card", index: idx, row: idx, action: "play" };
      }
      const total = Math.max(0, Math.trunc(Number(seconds) || 0));
      if (total <= 0) {
        void this.playStream(stream.id, { autoSelected: true });
        return;
      }
      this.autoPlayCountdown = {
        streamId: stream.id,
        label: getStreamHeadline(stream) || stream.addonName || "stream",
        secondsLeft: total
      };
      this.requestRender({ delayMs: 0 });
      this.autoPlayTimer = setInterval(() => {
        if (!this.autoPlayCountdown) {
          return;
        }
        this.autoPlayCountdown.secondsLeft -= 1;
        if (this.autoPlayCountdown.secondsLeft <= 0) {
          const targetId = this.autoPlayCountdown.streamId;
          this.cancelAutoPlayCountdown();
          void this.playStream(targetId, { autoSelected: true });
          return;
        }
        this.requestRender({ delayMs: 0 });
      }, 1000);
    },
    cancelAutoPlayCountdown() {
      if (this.autoPlayTimer) {
        clearInterval(this.autoPlayTimer);
        this.autoPlayTimer = null;
      }
      if (this.autoPlayCountdown) {
        this.autoPlayCountdown = null;
        this.requestRender({ delayMs: 0 });
      }
    },
    renderAutoPlayOverlay() {
      if (!this.autoPlayCountdown) {
        return "";
      }
      const { label, secondsLeft } = this.autoPlayCountdown;
      return `
          <div class="stream-route-autoplay">
            <div class="stream-route-autoplay-card">
              <div class="stream-route-autoplay-title">${escapeHtml(t("stream_autoplay_title", {}, "Auto-playing"))}</div>
              <div class="stream-route-autoplay-name">${escapeHtml(label)}</div>
              <div class="stream-route-autoplay-count">${escapeHtml(t("stream_autoplay_countdown", [secondsLeft], `Starting in ${secondsLeft}s`))}</div>
              <div class="stream-route-autoplay-hint">${escapeHtml(t("stream_autoplay_hint", {}, "Press OK to play now, or any key to choose manually"))}</div>
            </div>
          </div>`;
    },
    renderContinueWatchingResumeOverlay() {
      if (!this.autoResumeUiActive) {
        return "";
      }
      const title = String(this.params?.episodeTitle || this.params?.itemTitle || this.params?.playerTitle || "").trim();
      return `
          <div class="stream-route-autoplay">
            <div class="stream-route-autoplay-card">
              <div class="stream-route-autoplay-title">${escapeHtml(t("stream_finding_source", {}, "Finding stream source"))}</div>
              ${title ? `<div class="stream-route-autoplay-name">${escapeHtml(title)}</div>` : ""}
            </div>
          </div>`;
    },
    scheduleErrorChipCleanup() {
      if (this.errorChipTimer) {
        clearTimeout(this.errorChipTimer);
        this.errorChipTimer = null;
      }
      if (!this.sourceChips.some((chip) => chip.status === "error")) {
        return;
      }
      this.errorChipTimer = setTimeout(() => {
        this.errorChipTimer = null;
        this.sourceChips = this.sourceChips.filter((chip) => chip.status !== "error");
        if (!this.refreshSourceChipsOnly()) {
          this.requestRender();
        }
      }, 1600);
    },
    getOrderedFilterNames() {
      return getOrderedFilterNames(this.sourceChips, this.streams);
    },
    getFilteredStreams(filter = this.addonFilter) {
      // Cache the sorted/filtered result so focus navigation (which re-requests
      // this on every move via badge hydration) does not re-sort and re-parse
      // the whole source list each keypress. The cache is keyed on the inputs
      // that affect the result and is cleared in render() when data changes.
      const cache = this._filteredStreamsCache;
      // The party host's shared link is listed first in every filter (Android).
      const shared = this.getPartySharedEntry();
      if (
        cache &&
        cache.streams === this.streams &&
        cache.chips === this.sourceChips &&
        cache.filter === filter &&
        cache.shared === shared
      ) {
        return cache.result;
      }
      const orderedStreams = sortStreamsByAddonOrder(this.streams, this.sourceChips);
      const filtered = filter === "all" ? orderedStreams : orderedStreams.filter((stream) => stream.addonName === filter);
      const result = shared ? [shared, ...filtered] : filtered;
      this._filteredStreamsCache = {
        streams: this.streams,
        chips: this.sourceChips,
        filter,
        shared,
        result
      };
      return result;
    },
    hasPendingSourceLoads(filter = this.addonFilter) {
      if (this.loading) {
        return true;
      }
      if (!Array.isArray(this.sourceChips) || !this.sourceChips.length) {
        return false;
      }
      if (filter === "all") {
        return this.sourceChips.some((chip) => chip.status === "loading");
      }
      return this.sourceChips.some((chip) => chip.name === filter && chip.status === "loading");
    },
    setAddonFilter(nextFilter, preferredZone = "filter", preferredIndex = 0) {
      this.streamUserMovedFocus = true;
      const targetFilter = String(nextFilter || "all");
      const filterChanged = targetFilter !== this.addonFilter;
      this.addonFilter = targetFilter;
      const filtered = this.getFilteredStreams(targetFilter);
      if (preferredZone === "card" && filtered.length) {
        this.focusState = {
          zone: "card",
          // Carrying the previous row index into a different source's list picks
          // an unrelated stream. Each tab is its own list, so start at the top.
          row: filterChanged ? 0 : clamp(preferredIndex, 0, filtered.length - 1),
          action: "play"
        };
      } else {
        const ordered = ["all", ...this.getOrderedFilterNames()];
        this.focusState = {
          zone: "filter",
          index: 1 + clamp(ordered.indexOf(targetFilter), 0, Math.max(0, ordered.length - 1))
        };
      }
      // Android's LazyColumn effect is keyed by the selected addon, so
      // reselecting the active chip does not jump the list back to the top.
      if (filterChanged) {
        this.listScrollTop = 0;
        this.streamVirtualFocusReset = true;
      }
      if (preferredZone === "card" && filtered.length) {
        this.streamVirtualPreferredIndex = filterChanged ? 0 : clamp(preferredIndex, 0, filtered.length - 1);
      }
      if (this.applyAddonFilterInPlace({ filterChanged })) {
        return;
      }
      this.render();
    }
  };
}
