/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

// The issue reproduced successful windows up to 22.4 s late; include another retry interval.
const WEBOS_EMBEDDED_TEXT_SUBTITLE_HTML_RECOVERY_GRACE_SECONDS = 30;

export function shouldPreserveWebOsEmbeddedHtmlSubtitleRenderer({
  hasExistingWebOsRenderer,
  isRangeUnavailable,
  transientFailureCount,
  maxTransientFailures,
  usingHtml,
  windowStartSeconds,
  windowEndSeconds,
  subtitleTimeSeconds
}) {
  if (!hasExistingWebOsRenderer || isRangeUnavailable) {
    return false;
  }
  if (transientFailureCount < maxTransientFailures) {
    return true;
  }

  const windowStart = Number(windowStartSeconds);
  const windowEnd = Number(windowEndSeconds);
  const subtitleTime = Number(subtitleTimeSeconds);
  const hasReusableHtmlWindow =
    usingHtml &&
    Number.isFinite(windowStart) &&
    Number.isFinite(windowEnd) &&
    Number.isFinite(subtitleTime) &&
    windowEnd > windowStart &&
    subtitleTime >= windowStart &&
    subtitleTime < windowEnd + WEBOS_EMBEDDED_TEXT_SUBTITLE_HTML_RECOVERY_GRACE_SECONDS;

  return hasReusableHtmlWindow;
}

export function createPlayerScreenMethods44() {
  const {
    PlayerController,
    localMediaEmbeddedSubtitleRepository,
    Environment,
    WEBOS_EMBEDDED_TEXT_SUBTITLE_MAX_TRANSIENT_FAILURES,
    EMBEDDED_TEXT_SUBTITLE_WINDOW_SECONDS,
    EMBEDDED_TEXT_SUBTITLE_PREFETCH_SECONDS,
    EMBEDDED_TEXT_SUBTITLE_WINDOW_BUCKET_SECONDS,
    isTx3gSubtitleTrack,
    getEmbeddedSubtitleSupportState,
    isTizenTx3gEmbeddedSubtitleTrack,
    isTizenSubRipEmbeddedSubtitleTrack,
    isTizenEmbeddedTextSubtitleFallbackTrack,
    isAssSubtitleCodec
  } = internals;

  return {
    async loadWebOsEmbeddedTextSubtitleWindow(timeSeconds) {
      const track = this.webOsEmbeddedTextSubtitleTrack;
      const sourceUrl = this.getTrackProbeUrl();
      const sourceTrackId = Number(track?.sourceTrackId);
      const sourceTrackOrdinal = Number(track?.sourceTrackOrdinal);
      const isTizenSubRipFallback = isTizenSubRipEmbeddedSubtitleTrack(track);
      const hasValidTrackSelector = isTizenSubRipFallback
        ? Number.isFinite(sourceTrackOrdinal) && sourceTrackOrdinal >= 0
        : Number.isFinite(sourceTrackId) && sourceTrackId > 0;
      if (
        (!Environment.isWebOS() && !isTizenEmbeddedTextSubtitleFallbackTrack(track)) ||
        !track ||
        !sourceUrl ||
        !hasValidTrackSelector ||
        this.webOsEmbeddedTextSubtitleFallbackUnavailable ||
        this.webOsEmbeddedTextSubtitleLoading
      ) {
        return false;
      }
      const requestToken = Number(this.webOsEmbeddedTextSubtitleLoadToken || 0) + 1;
      this.webOsEmbeddedTextSubtitleLoadToken = requestToken;
      this.webOsEmbeddedTextSubtitleLoading = true;
      // Keep fetch failures separate from parsing/renderer failures. The former
      // can leave the last successfully rendered window in place while retrying.
      let windowRequestCompleted = false;
      const subtitleTime = Math.max(0, Number(timeSeconds || 0));
      const startSeconds =
        Math.floor(subtitleTime / EMBEDDED_TEXT_SUBTITLE_WINDOW_BUCKET_SECONDS) * EMBEDDED_TEXT_SUBTITLE_WINDOW_BUCKET_SECONDS;
      try {
        const windowData = await localMediaEmbeddedSubtitleRepository.getWindow({
          url: sourceUrl,
          trackNumber: isTizenSubRipFallback ? undefined : sourceTrackId,
          trackOrdinal: isTizenSubRipFallback ? sourceTrackOrdinal : undefined,
          startSeconds,
          endSeconds: startSeconds + EMBEDDED_TEXT_SUBTITLE_WINDOW_SECONDS,
          includeAssBody:
            this.webOsEmbeddedTextSubtitleUsingAss || isAssSubtitleCodec(track?.codec) || isAssSubtitleCodec(track?.codec_name)
        });
        windowRequestCompleted = true;
        if (requestToken !== this.webOsEmbeddedTextSubtitleLoadToken || this.webOsEmbeddedTextSubtitleTrack !== track) {
          return false;
        }

        if (isTx3gSubtitleTrack(track)) {
          this.embeddedTextSubtitleSupportNotice = "";
          if (Environment.isTizen()) {
            track.supported = true;
            track.unsupportedReason = null;
          }
        }

        this.webOsEmbeddedTextSubtitleWindowStart = Number(windowData.windowStartSeconds || startSeconds);
        this.webOsEmbeddedTextSubtitleWindowEnd = Number(
          windowData.windowEndSeconds || startSeconds + EMBEDDED_TEXT_SUBTITLE_WINDOW_SECONDS
        );
        const assBody = String(windowData.assBody || "");
        // Select the renderer from stable track metadata. The advanced-tag flag
        // is local to this extraction window and can otherwise switch from the
        // VTT fallback to ass.js while playback is already running, leaving the
        // newly-created renderer stuck on its initial cue.
        const shouldUseAss =
          Boolean(assBody) &&
          (isAssSubtitleCodec(windowData.codecId) || isAssSubtitleCodec(track?.codec) || isAssSubtitleCodec(track?.codec_name));
        if (shouldUseAss) {
          const assResult = await this.applyAssSubtitleBody({
            body: assBody,
            selectionToken: this.subtitleSelectionToken,
            isCurrent: () => requestToken === this.webOsEmbeddedTextSubtitleLoadToken && this.webOsEmbeddedTextSubtitleTrack === track
          });
          if (requestToken !== this.webOsEmbeddedTextSubtitleLoadToken || this.webOsEmbeddedTextSubtitleTrack !== track) {
            return false;
          }
          if (assResult.stale) return false;
          if (assResult.applied) {
            if (typeof PlayerController.setWebOsEmbeddedSubtitleNativeVisibility !== "function") {
              this.destroyAssSubtitleRenderer();
              return false;
            }
            // Claim webOS app ownership before the native-hide round trip so a
            // queued native refresh cannot re-enable the renderer in parallel.
            const wasUsingHtml = this.webOsEmbeddedTextSubtitleUsingHtml;
            const canClaimWebOsAssOwnership = Environment.isWebOS();
            if (canClaimWebOsAssOwnership) {
              this.webOsEmbeddedTextSubtitleUsingAss = true;
              this.webOsEmbeddedTextSubtitleUsingHtml = false;
            }
            const nativeRendererHidden = await Promise.resolve(
              PlayerController.setWebOsEmbeddedSubtitleNativeVisibility(false, this.selectedEmbeddedSubtitleTrackIndex)
            );
            if (
              !nativeRendererHidden ||
              requestToken !== this.webOsEmbeddedTextSubtitleLoadToken ||
              this.webOsEmbeddedTextSubtitleTrack !== track
            ) {
              if (canClaimWebOsAssOwnership) {
                this.webOsEmbeddedTextSubtitleUsingAss = false;
                this.webOsEmbeddedTextSubtitleUsingHtml = wasUsingHtml;
              }
              this.destroyAssSubtitleRenderer();
              return false;
            }
            this.clearHtmlSubtitleOverlay();
            this.webOsEmbeddedTextSubtitleUsingAss = true;
            this.webOsEmbeddedTextSubtitleUsingHtml = false;
            this.webOsEmbeddedTextSubtitleWindowFailureCount = 0;
            return true;
          }
          if (assResult.fallbackVtt) {
            windowData.body = assResult.fallbackVtt;
          }
        }

        if (this.webOsEmbeddedTextSubtitleUsingAss) {
          this.destroyAssSubtitleRenderer();
          this.webOsEmbeddedTextSubtitleUsingAss = false;
        }
        const isAssTrack =
          isAssSubtitleCodec(windowData.codecId) ||
          isAssSubtitleCodec(track?.codec) ||
          isAssSubtitleCodec(track?.codec_name) ||
          Boolean(windowData.assBody);
        const cues = this.parseSubtitleCues(windowData.body);
        const shouldUseHtml =
          isTizenEmbeddedTextSubtitleFallbackTrack(track) ||
          (Environment.isWebOS() && this.subtitleRenderMode === "html") ||
          this.webOsEmbeddedTextSubtitleUsingHtml ||
          Boolean(windowData.hasAssOverrideTags) ||
          (isAssTrack && cues.length > 0);
        if (!shouldUseHtml || (!cues.length && !this.webOsEmbeddedTextSubtitleUsingHtml)) {
          return false;
        }

        if (!this.webOsEmbeddedTextSubtitleUsingHtml) {
          // Tizen uses a synchronous AVPlay render-mode switch; keep its
          // existing ordering while claiming ownership early on webOS, where
          // the native hide is asynchronous.
          const canClaimWebOsHtmlOwnership = Environment.isWebOS();
          if (canClaimWebOsHtmlOwnership) {
            this.webOsEmbeddedTextSubtitleUsingHtml = true;
          }
          const nativeRendererHidden = isTizenEmbeddedTextSubtitleFallbackTrack(track)
            ? Boolean(PlayerController.applyAvPlaySubtitleRenderMode?.("html"))
            : typeof PlayerController.setWebOsEmbeddedSubtitleNativeVisibility === "function"
              ? await Promise.resolve(
                  PlayerController.setWebOsEmbeddedSubtitleNativeVisibility(false, this.selectedEmbeddedSubtitleTrackIndex)
                )
              : false;
          if (
            requestToken !== this.webOsEmbeddedTextSubtitleLoadToken ||
            this.webOsEmbeddedTextSubtitleTrack !== track ||
            !nativeRendererHidden
          ) {
            if (canClaimWebOsHtmlOwnership) {
              this.webOsEmbeddedTextSubtitleUsingHtml = false;
            }
            return false;
          }
          if (!canClaimWebOsHtmlOwnership) {
            this.webOsEmbeddedTextSubtitleUsingHtml = true;
          }
        }

        this.htmlSubtitleCues = cues;
        this.htmlSubtitleSelectedId = isTizenTx3gEmbeddedSubtitleTrack(track)
          ? `tizen-tx3g-${this.selectedEmbeddedSubtitleTrackIndex}`
          : isTizenSubRipEmbeddedSubtitleTrack(track)
            ? `tizen-embedded-text-${this.selectedEmbeddedSubtitleTrackIndex}`
            : `webos-embedded-text-${this.selectedEmbeddedSubtitleTrackIndex}`;
        this.renderHtmlSubtitleOverlayCue([]);
        this.renderHtmlSubtitleOverlayAtCurrentTime();
        this.scheduleHtmlSubtitleOverlayRender();
        this.webOsEmbeddedTextSubtitleWindowFailureCount = 0;
        return true;
      } catch (error) {
        if (requestToken === this.webOsEmbeddedTextSubtitleLoadToken && this.webOsEmbeddedTextSubtitleTrack === track) {
          this.webOsEmbeddedTextSubtitleLastErrorAt = Date.now();
          const isRangeUnavailable = error?.code === "RANGE_UNAVAILABLE";
          const hasExistingWebOsRenderer =
            Environment.isWebOS() &&
            !windowRequestCompleted &&
            (this.webOsEmbeddedTextSubtitleUsingAss || this.webOsEmbeddedTextSubtitleUsingHtml);
          const transientFailureCount = hasExistingWebOsRenderer ? Number(this.webOsEmbeddedTextSubtitleWindowFailureCount || 0) + 1 : 0;
          const playbackTime = Number(this.getPlaybackCurrentSeconds?.());
          const subtitleDelaySeconds = Number(this.subtitleDelayMs || 0) / 1000;
          const currentSubtitleTime = Math.max(
            0,
            (Number.isFinite(playbackTime) ? playbackTime : subtitleTime) -
              (Number.isFinite(subtitleDelaySeconds) ? subtitleDelaySeconds : 0)
          );
          const preserveExistingWebOsRenderer = shouldPreserveWebOsEmbeddedHtmlSubtitleRenderer({
            hasExistingWebOsRenderer,
            isRangeUnavailable,
            transientFailureCount,
            maxTransientFailures: WEBOS_EMBEDDED_TEXT_SUBTITLE_MAX_TRANSIENT_FAILURES,
            usingHtml: this.webOsEmbeddedTextSubtitleUsingHtml,
            windowStartSeconds: this.webOsEmbeddedTextSubtitleWindowStart,
            windowEndSeconds: this.webOsEmbeddedTextSubtitleWindowEnd,
            subtitleTimeSeconds: currentSubtitleTime
          });
          if (hasExistingWebOsRenderer) {
            this.webOsEmbeddedTextSubtitleWindowFailureCount = transientFailureCount;
          }
          if (
            isRangeUnavailable ||
            (transientFailureCount >= WEBOS_EMBEDDED_TEXT_SUBTITLE_MAX_TRANSIENT_FAILURES && !preserveExistingWebOsRenderer)
          ) {
            this.webOsEmbeddedTextSubtitleFallbackUnavailable = true;
          }
          if (Environment.isWebOS() && !preserveExistingWebOsRenderer) {
            this.webOsEmbeddedTextSubtitleUsingAss = false;
            this.webOsEmbeddedTextSubtitleUsingHtml = false;
            this.clearHtmlSubtitleOverlay();
            void Promise.resolve(
              PlayerController.setWebOsEmbeddedSubtitleNativeVisibility?.(true, this.selectedEmbeddedSubtitleTrackIndex)
            ).catch(() => {});
          }
          console.warn("Embedded text subtitle rendering failed", {
            trackNumber: sourceTrackId,
            trackOrdinal: sourceTrackOrdinal,
            code: error?.code || "",
            details: error?.details || null,
            error: error?.message || String(error || "")
          });
          if (isTx3gSubtitleTrack(track)) {
            this.markEmbeddedTextSubtitleUnsupported(track);
          }
          if (isTizenEmbeddedTextSubtitleFallbackTrack(track)) {
            // Keep playback alive when the optional extractor is unavailable on
            // a supported firmware; AVPlay can still render natively on devices
            // that implement the selected text codec despite the documented gap.
            PlayerController.applyAvPlaySubtitleRenderMode?.("native");
          }
        }
        return false;
      } finally {
        if (requestToken === this.webOsEmbeddedTextSubtitleLoadToken) {
          this.webOsEmbeddedTextSubtitleLoading = false;
        }
      }
    },
    renderWebOsEmbeddedTextSubtitleAtCurrentTime() {
      const track = this.webOsEmbeddedTextSubtitleTrack;
      if (!track) {
        return false;
      }
      const currentTime = Number(this.getPlaybackCurrentSeconds() || 0);
      const subtitleTime = Math.max(0, currentTime - Number(this.subtitleDelayMs || 0) / 1000);
      const outsideWindow =
        subtitleTime < this.webOsEmbeddedTextSubtitleWindowStart || subtitleTime >= this.webOsEmbeddedTextSubtitleWindowEnd;
      const approachingWindowEnd =
        this.webOsEmbeddedTextSubtitleWindowEnd > 0 &&
        subtitleTime >= this.webOsEmbeddedTextSubtitleWindowEnd - EMBEDDED_TEXT_SUBTITLE_PREFETCH_SECONDS;
      if ((outsideWindow || approachingWindowEnd) && !this.webOsEmbeddedTextSubtitleLoading) {
        const retryAllowed = !this.webOsEmbeddedTextSubtitleLastErrorAt || Date.now() - this.webOsEmbeddedTextSubtitleLastErrorAt >= 5000;
        if (retryAllowed) {
          void this.loadWebOsEmbeddedTextSubtitleWindow(subtitleTime);
        }
      }
      return this.webOsEmbeddedTextSubtitleUsingHtml
        ? this.renderHtmlSubtitleOverlayAtCurrentTime()
        : this.webOsEmbeddedTextSubtitleUsingAss;
    },
    prepareBitmapSubtitleForSeek(timeSeconds) {
      const track = this.bitmapSubtitleTrack;
      if (!track || getEmbeddedSubtitleSupportState(track).supported === false) {
        return;
      }
      const targetSeconds = Math.max(0, Number(timeSeconds) || 0);
      this.bitmapSubtitleLoadToken = Number(this.bitmapSubtitleLoadToken || 0) + 1;
      this.bitmapSubtitleLoading = false;
      this.bitmapSubtitleLastErrorAt = 0;
      this.clearBitmapSubtitleCanvas();
      const outsideWindow = targetSeconds < this.bitmapSubtitleWindowStart || targetSeconds >= this.bitmapSubtitleWindowEnd;
      if (outsideWindow) {
        this.bitmapSubtitleDecoder?.dispose?.();
        this.bitmapSubtitleDecoder = null;
        this.bitmapSubtitleWindowStart = 0;
        this.bitmapSubtitleWindowEnd = 0;
        void this.loadBitmapSubtitleWindow(targetSeconds);
      }
    }
  };
}
