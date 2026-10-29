import { canResolveMediaServerStream } from "../../../data/mediaserver/mediaServerRepository.js";
import { syncHtmlSubtitleClearance } from "./subtitleOverlayClearance.js";
/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods09() {
  const {
    PlayerSettingsStore,
    DirectDebridResolver,
    WebOsEngineFsResolver,
    TizenStreamingServerResolver,
    findFollowingPostCreditsScene,
    getSkipIntervalTargetSeconds,
    SKIP_INTERVAL_CHECK_MS,
    SKIP_INTERVAL_SEEK_SUPPRESSION_MS,
    clamp,
    escapeHtml,
    isPlayerDomNodeAttached,
    buildSkipIntervalLabel,
    getSkipIntervalKey,
    uniqueNonEmptyValues
  } = internals;

  return {
    renderSkipIntroButton() {
      const button = this.uiRefs?.skipIntro;
      if (!button) {
        return;
      }
      const activeInterval = this.activeSkipInterval;
      const playbackReady = this.isSkipIntroPlaybackReady();
      const shouldShow = Boolean(activeInterval) && playbackReady && !this.skipIntervalDismissed;
      const isVisible = shouldShow && (!this.skipIntroAutoHidden || this.controlsVisible);
      const activeKey = activeInterval ? `${activeInterval.type}:${activeInterval.startTime}:${activeInterval.endTime}` : "none";
      const renderKey = `${activeKey}|ready:${playbackReady ? 1 : 0}|controls:${this.controlsVisible ? 1 : 0}|hidden:${this.skipIntroAutoHidden ? 1 : 0}|dismissed:${this.skipIntervalDismissed ? 1 : 0}`;
      button.classList.toggle("hidden", !isVisible);
      button.classList.toggle("is-raised", Boolean(this.controlsVisible));
      if (!isVisible && this.controlFocusZone === "skipIntro") {
        this.controlFocusZone = this.controlsVisible && this.isSeekBarAvailable() ? "progress" : "buttons";
      }
      if (!shouldShow) {
        button.innerHTML = "";
        this.skipIntroRenderedKey = renderKey;
        syncHtmlSubtitleClearance(this);
        return;
      }
      if (this.skipIntroRenderedKey !== renderKey || !button.querySelector(".player-skip-intro-btn")) {
        const targetsPostCredits = Boolean(
          activeInterval && findFollowingPostCreditsScene(activeInterval, this.skipIntervals, this.getPlaybackDurationSeconds())
        );
        const label = buildSkipIntervalLabel(activeInterval, { targetsPostCredits });
        const progress = clamp(this.skipIntroCountdownProgress, 0, 1);
        const progressVisible = !this.controlsVisible && !this.skipIntroAutoHidden && !this.skipIntervalDismissed;
        button.innerHTML = `
            <button class="player-skip-intro-btn focusable" type="button" tabindex="-1" data-player-pointer-action="skipIntro" style="--skip-intro-progress-visible:${progressVisible ? 1 : 0};">
              <span class="player-skip-intro-content">
                <span class="player-skip-intro-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                    <path d="M6 18l8.5-6L6 6v12zm10-12v12h2V6h-2z" fill="currentColor"></path>
                  </svg>
                </span>
                <span class="player-skip-intro-label">${escapeHtml(label)}</span>
              </span>
              <span class="player-skip-intro-progress" aria-hidden="true">
                <span class="player-skip-intro-progress-track"></span>
                <span class="player-skip-intro-progress-fill" style="transform:scaleX(${progress.toFixed(4)})"></span>
              </span>
            </button>
          `;
        this.skipIntroRenderedKey = renderKey;
      }
      this.syncSkipIntroButtonProgress();
      syncHtmlSubtitleClearance(this);
      const focusTarget = this.uiRefs?.skipIntro?.querySelector(".player-skip-intro-btn");
      if (focusTarget) {
        if (!focusTarget.dataset.skipIntroThemeBound) {
          const syncTheme = () => this.syncSkipIntroButtonTheme(focusTarget);
          focusTarget.addEventListener("focus", syncTheme, true);
          focusTarget.addEventListener("blur", syncTheme, true);
          focusTarget.dataset.skipIntroThemeBound = "1";
        }
        focusTarget.classList.toggle("focused", this.controlFocusZone === "skipIntro");
        this.syncSkipIntroButtonTheme(focusTarget);
      }
      if (
        isVisible &&
        !this.controlsVisible &&
        !this.skipIntroAutoHidden &&
        !this.skipIntervalDismissed &&
        this.controlFocusZone !== "nextEpisode"
      ) {
        if (this.skipIntroFocusFrame != null && typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(this.skipIntroFocusFrame);
        }
        if (typeof requestAnimationFrame === "function") {
          this.skipIntroFocusFrame = requestAnimationFrame(() => {
            this.skipIntroFocusFrame = null;
            const focusTarget = this.uiRefs?.skipIntro?.querySelector(".player-skip-intro-btn");
            if (!focusTarget || !isPlayerDomNodeAttached(focusTarget)) {
              return;
            }
            if (this.controlFocusZone === "nextEpisode") {
              return;
            }
            if (document.activeElement === focusTarget) {
              return;
            }
            try {
              focusTarget.focus();
              this.syncSkipIntroButtonTheme(focusTarget);
            } catch (_) {
              // Some webOS runtimes can reject focus during DOM churn; harmless.
            }
          });
        } else {
          try {
            const fallbackTarget = button.querySelector(".player-skip-intro-btn");
            fallbackTarget?.focus?.();
            this.syncSkipIntroButtonTheme(fallbackTarget);
          } catch (_) {
            // no-op
          }
        }
      }
    },
    startSkipIntervalCheckTimer() {
      this.stopSkipIntervalCheckTimer();
      this.skipIntervalCheckTimer = setInterval(() => {
        if (this.isExternalFrameMode()) {
          return;
        }
        if (!PlayerSettingsStore.get().skipIntroEnabled) {
          return;
        }
        if (!Array.isArray(this.skipIntervals) || !this.skipIntervals.length) {
          return;
        }
        this.updateActiveSkipInterval(this.getPlaybackCurrentSeconds());
      }, SKIP_INTERVAL_CHECK_MS);
    },
    stopSkipIntervalCheckTimer() {
      if (this.skipIntervalCheckTimer) {
        clearInterval(this.skipIntervalCheckTimer);
        this.skipIntervalCheckTimer = null;
      }
    },
    skipActiveInterval() {
      if (!this.activeSkipInterval) {
        return false;
      }
      const interval = this.activeSkipInterval;
      const durationSeconds = this.getPlaybackDurationSeconds();
      const intervalTarget = getSkipIntervalTargetSeconds(interval, this.skipIntervals, durationSeconds);
      if (!Number.isFinite(intervalTarget)) {
        return false;
      }
      // Match Android: never seek past the media duration reported by the player.
      const requestedTime = durationSeconds > 0 ? Math.min(intervalTarget, durationSeconds) : intervalTarget;
      let targetTime = requestedTime;
      if (this.isPartyControlLocked?.()) {
        const partyTargetMs = this.ownSeekTarget(Math.round(requestedTime * 1000));
        if (partyTargetMs == null) {
          return false;
        }
        targetTime = partyTargetMs / 1000;
      }
      this.skipIntroSuppressedKey = getSkipIntervalKey(interval);
      this.skipIntroSuppressedUntil = Date.now() + SKIP_INTERVAL_SEEK_SUPPRESSION_MS;
      // Match Android: transfer focus before the focused skip button disappears.
      if (this.controlsVisible) this.focusFirstControl();
      this.seekPlaybackSeconds(targetTime, { preserveSkipIntroSuppression: true });
      this.publishPartyPlayback?.({ positionMs: Math.round(targetTime * 1000) });
      this.skipIntervalDismissed = true;
      this.activeSkipInterval = null;
      this.skipIntroAutoHidden = false;
      this.skipIntroCountdownProgress = 0;
      this.skipIntroCountdownLastTickAt = Date.now();
      this.skipIntroCountdownStartAt = 0;
      this.stopSkipIntroCountdownAnimation();
      this.renderSkipIntroButton();
      return true;
    },
    normalizeStreamCandidates(streams = []) {
      return (streams || [])
        .map((stream, index) => {
          const streamUrl = stream?.url || stream?.externalUrl || "";
          const streamOrigin = {
            ...(stream.raw?.streamOrigin || {}),
            ...(stream.streamOrigin || {}),
            addonId: stream.addonId || stream.raw?.addonId || stream.streamOrigin?.addonId || stream.raw?.streamOrigin?.addonId || null,
            addonBaseUrl:
              stream.addonBaseUrl ||
              stream.raw?.addonBaseUrl ||
              stream.streamOrigin?.addonBaseUrl ||
              stream.raw?.streamOrigin?.addonBaseUrl ||
              null,
            addonName:
              stream.addonName ||
              stream.sourceName ||
              stream.raw?.addonName ||
              stream.streamOrigin?.addonName ||
              stream.raw?.streamOrigin?.addonName ||
              "Addon",
            sourceProviderId:
              stream.sourceProviderId ||
              stream.raw?.sourceProviderId ||
              stream.streamOrigin?.sourceProviderId ||
              stream.raw?.streamOrigin?.sourceProviderId ||
              null
          };
          const rawAddonOrderIndex =
            stream.addonOrderIndex ??
            stream.raw?.addonOrderIndex ??
            stream.streamOrigin?.addonOrderIndex ??
            stream.raw?.streamOrigin?.addonOrderIndex;
          const addonOrderIndex = rawAddonOrderIndex == null ? null : Number(rawAddonOrderIndex);
          const entry = {
            id: stream.id || `stream-${index}-${streamUrl}`,
            label: stream.name || stream.title || stream.label || `Source ${index + 1}`,
            name: stream.name || null,
            title: stream.title || stream.label || null,
            isSynthetic: Boolean(stream.isSynthetic || stream.raw?.isSynthetic),
            description: stream.description || stream.name || "",
            addonId: stream.addonId || stream.raw?.addonId || null,
            addonBaseUrl: stream.addonBaseUrl || stream.raw?.addonBaseUrl || null,
            addonName: stream.addonName || stream.sourceName || "Addon",
            addonLogo: stream.addonLogo || null,
            sourceProviderId:
              stream.sourceProviderId ||
              stream.raw?.sourceProviderId ||
              stream.streamOrigin?.sourceProviderId ||
              stream.raw?.streamOrigin?.sourceProviderId ||
              null,
            streamOrigin,
            addonOrderIndex: Number.isFinite(addonOrderIndex) ? addonOrderIndex : null,
            mimeType: stream.mimeType || stream.raw?.mimeType || stream.type || stream.source || null,
            sourceType: stream.sourceType || stream.mimeType || stream.type || stream.source || "",
            url: streamUrl,
            ytId: stream.ytId || null,
            infoHash: stream.infoHash || null,
            fileIdx: stream.fileIdx ?? null,
            engineFs: stream.engineFs || stream.raw?.engineFs || null,
            tizenP2p: stream.tizenP2p || stream.raw?.tizenP2p || null,
            externalUrl: stream.externalUrl || null,
            behaviorHints: stream.behaviorHints || null,
            sources: Array.isArray(stream.sources) ? stream.sources : [],
            quality: stream.quality || null,
            qualityValue: Number.isFinite(Number(stream.qualityValue)) ? Number(stream.qualityValue) : -1,
            clientResolve: stream.clientResolve || stream.raw?.clientResolve || null,
            debridCacheStatus: stream.debridCacheStatus || null,
            subtitles: Array.isArray(stream.subtitles) ? stream.subtitles : [],
            raw: stream
          };
          return canResolveMediaServerStream(entry) ||
            DirectDebridResolver.shouldListStream(entry) ||
            WebOsEngineFsResolver.canResolveStream(entry) ||
            TizenStreamingServerResolver.canResolveStream(entry)
            ? entry
            : null;
        })
        .filter(Boolean);
    },
    getCurrentStreamCandidate() {
      if (!this.streamCandidates.length) {
        return null;
      }
      const current = this.streamCandidates[this.currentStreamIndex] || null;
      // Debrid/P2P candidates remain selected while their playback URL is resolving.
      // A ready URL on another candidate does not make it the current source.
      if (current) {
        return current;
      }
      return this.streamCandidates.find((entry) => Boolean(entry?.url)) || null;
    },
    normalizePlaybackSourceContext(context = null) {
      if (!context || typeof context !== "object") {
        return null;
      }
      const sourceIds = uniqueNonEmptyValues([
        ...(Array.isArray(context.sourceIds) ? context.sourceIds : []),
        context.sourceId,
        context.catalogId
      ]);
      const normalized = {
        addonId: String(context.addonId || "").trim(),
        addonBaseUrl: String(context.addonBaseUrl || "").trim(),
        addonName: String(context.addonName || "").trim(),
        addonOrderIndex: Number.isFinite(Number(context.addonOrderIndex)) ? Number(context.addonOrderIndex) : null,
        sourceProviderId: String(context.sourceProviderId || context.providerId || "").trim(),
        originKind: String(context.originKind || context.kind || context.streamOrigin?.kind || "")
          .trim()
          .toLowerCase(),
        sourceId: sourceIds[0] || "",
        sourceIds,
        catalogId: String(context.catalogId || "").trim(),
        streamOrigin: context.streamOrigin && typeof context.streamOrigin === "object" ? { ...context.streamOrigin } : null,
        selectedStreamId: String(context.selectedStreamId || "").trim(),
        selectedStreamIndex: Number.isFinite(Number(context.selectedStreamIndex)) ? Number(context.selectedStreamIndex) : null
      };
      return Object.values({
        addonId: normalized.addonId,
        addonBaseUrl: normalized.addonBaseUrl,
        addonName: normalized.addonName,
        sourceProviderId: normalized.sourceProviderId,
        sourceId: normalized.sourceId
      }).some(Boolean)
        ? normalized
        : null;
    },
    getPlaybackSourceContext(streamCandidate = null) {
      const stream = streamCandidate || null;
      if (!stream) {
        return this.normalizePlaybackSourceContext(
          this.activePlaybackSourceContext || this.params?.playbackSourceContext || this.params?.sourceContext || null
        );
      }
      const raw = stream.raw || {};
      const origin = stream.streamOrigin || raw.streamOrigin || {};
      const sourceIds = uniqueNonEmptyValues([
        ...(Array.isArray(stream.sources) ? stream.sources : []),
        ...(Array.isArray(raw.sources) ? raw.sources : []),
        stream.sourceId,
        raw.sourceId,
        origin.sourceId,
        stream.catalogId,
        raw.catalogId,
        origin.catalogId
      ]);
      const selectedStreamIndex = this.streamCandidates?.indexOf?.(stream);
      return this.normalizePlaybackSourceContext({
        addonId: stream.addonId || raw.addonId || origin.addonId || "",
        addonBaseUrl: stream.addonBaseUrl || raw.addonBaseUrl || origin.addonBaseUrl || "",
        addonName: stream.addonName || raw.addonName || origin.addonName || "",
        addonOrderIndex: stream.addonOrderIndex ?? raw.addonOrderIndex ?? origin.addonOrderIndex ?? null,
        sourceProviderId: stream.sourceProviderId || raw.sourceProviderId || origin.sourceProviderId || "",
        originKind: origin.kind || stream.originKind || raw.originKind || "",
        sourceIds,
        sourceId: sourceIds[0] || "",
        catalogId: stream.catalogId || raw.catalogId || origin.catalogId || "",
        streamOrigin: origin,
        selectedStreamId: stream.id || "",
        selectedStreamIndex: Number.isFinite(selectedStreamIndex) && selectedStreamIndex >= 0 ? selectedStreamIndex : null
      });
    }
  };
}
