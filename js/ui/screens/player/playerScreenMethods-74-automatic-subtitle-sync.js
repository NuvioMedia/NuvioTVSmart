/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";
import { AUTO_SYNC_TOLERANCE_OPTIONS_MS } from "../../../core/player/subtitleAutoSyncEngine.js";
import { alignSubtitleAutoSyncAsync } from "../../../core/player/subtitleAutoSyncWorkerClient.js";
import { retimeAutoSyncSubtitleText } from "../../../core/player/subtitleAutoSyncRetimer.js";
import { isConfirmedAutoSyncNoFit } from "../../../core/player/autosyncOutcome.js";

const AUTO_SYNC_TOAST_MS = 2200;

function normalizeToleranceMs(value) {
  const tolerance = Math.trunc(Number(value));
  return AUTO_SYNC_TOLERANCE_OPTIONS_MS.includes(tolerance) ? tolerance : 0;
}

// Only the timing fields cross the worker boundary; cue markup stays here.
function toAutoSyncTargetCue(cue) {
  return {
    start: cue?.start,
    end: cue?.end,
    startTimeMs: cue?.startTimeMs,
    endTimeMs: cue?.endTimeMs,
    text: cue?.text
  };
}

export function createPlayerScreenMethods74() {
  const {
    PlayerSettingsStore,
    Environment,
    localMediaEmbeddedSubtitleRepository,
    convertAssBodyToVtt,
    isTx3gSubtitleTrack,
    normalizeSubtitleLanguageKey,
    t
  } = internals;

  return {
    resetAutomaticSubtitleSyncState({ resetStartupKey = false } = {}) {
      this.automaticSubtitleSyncRunToken = Number(this.automaticSubtitleSyncRunToken || 0) + 1;
      if (this.automaticSubtitleSyncTimer) {
        clearTimeout(this.automaticSubtitleSyncTimer);
        this.automaticSubtitleSyncTimer = null;
      }
      this.autoSyncedSubtitleUrl = "";
      this.currentAddonSubtitleSource = null;
      if (resetStartupKey) {
        this.automaticSubtitleSyncStartupKey = "";
      }
    },
    setAddonSubtitleAutoSyncSource({ subtitle, subtitleId, cues = null, rawBody = "", isAss = false } = {}) {
      const subtitleUrl = String(subtitle?.url || "").trim();
      if (!subtitleUrl) {
        this.currentAddonSubtitleSource = null;
        return;
      }
      this.currentAddonSubtitleSource = {
        subtitleId: String(subtitleId || subtitle?.id || subtitleUrl),
        subtitleUrl,
        cues: Array.isArray(cues) ? cues.slice() : [],
        rawBody: String(rawBody || ""),
        isAss: Boolean(isAss)
      };
    },
    isSubtitleOptionAutoSynced(option) {
      const syncedUrl = String(this.autoSyncedSubtitleUrl || "").trim();
      if (!syncedUrl) {
        return false;
      }
      const track = option?.entry?.track || {};
      const candidateUrl = String(track.url || option?.entry?.id || "").trim();
      return Boolean(candidateUrl) && candidateUrl === syncedUrl;
    },
    getAutomaticSubtitleSyncSettings() {
      const style = PlayerSettingsStore.get().subtitleStyle || {};
      return {
        enabled: style.autoSyncEnabled === true,
        toleranceMs: normalizeToleranceMs(style.autoSyncToleranceMs),
        thorough: style.autoSyncThorough !== false
      };
    },
    getSubtitleAutoSyncReferenceRequests(subtitle, thorough = true) {
      const allTracks = Array.isArray(this.embeddedSubtitleTracks) ? this.embeddedSubtitleTracks : [];
      const textTracks = allTracks.filter((track) => track && !track.bitmapSubtitle);
      if (allTracks.length && !textTracks.length) {
        return [];
      }
      if (!textTracks.length) {
        return [{ trackNumber: 0, trackOrdinal: -1 }];
      }

      const targetLanguage = normalizeSubtitleLanguageKey(subtitle?.lang || subtitle?.language || subtitle?.languageCode || "");
      const matchesLanguage = (track) => {
        const trackLanguage = normalizeSubtitleLanguageKey(track?.language || "");
        if (!targetLanguage || !trackLanguage) {
          return false;
        }
        return trackLanguage === targetLanguage || trackLanguage.split("-")[0] === targetLanguage.split("-")[0];
      };
      const orderedTracks = [
        ...textTracks.filter((track) => matchesLanguage(track) && !track.forced),
        ...textTracks.filter((track) => matchesLanguage(track) && track.forced),
        ...textTracks.filter((track) => !matchesLanguage(track) && !track.forced),
        ...textTracks.filter((track) => !matchesLanguage(track) && track.forced)
      ];
      const uniqueTracks = orderedTracks.filter((track, index) => orderedTracks.indexOf(track) === index);
      return uniqueTracks.slice(0, thorough ? 4 : 1).map((track) => {
        if (Environment.isTizen() && !isTx3gSubtitleTrack(track)) {
          const trackOrdinal = Number(track.sourceTrackOrdinal);
          return {
            trackNumber: 0,
            trackOrdinal: Number.isFinite(trackOrdinal) && trackOrdinal >= 0 ? trackOrdinal : -1
          };
        }
        const trackNumber = Number(track.sourceTrackId);
        return {
          trackNumber: Number.isFinite(trackNumber) && trackNumber > 0 ? trackNumber : 0,
          trackOrdinal: -1
        };
      });
    },
    showAutomaticSubtitleSyncNoFit() {
      // The only AutoSync failure worth reporting: the subtitle was compared with every
      // embedded reference and clearly matches none of them. Technical or inconclusive
      // failures stay silent, like Android.
      const message = t("autosync_toast_no_fit", {}, "Sync failed: these subtitles don't match this version of the video.");
      if (typeof this.showAspectToast === "function") {
        this.showAspectToast(message, AUTO_SYNC_TOAST_MS);
      }
    },
    markSubtitleAutoSynced(subtitle) {
      this.autoSyncedSubtitleUrl = String(subtitle?.url || subtitle?.id || "").trim();
      this.invalidateTrackDialogCaches();
      this.renderSubtitleDialog();
    },
    async applyAutomaticSubtitleSyncTimeline({ subtitle, source, timeline } = {}) {
      if (!timeline?.confident || !source) {
        return false;
      }
      const isCurrentTarget = () =>
        String(this.selectedAddonSubtitleId || "") === source.subtitleId &&
        String(this.currentAddonSubtitleSource?.subtitleUrl || "") === source.subtitleUrl;

      if (source.isAss) {
        const retimedBody = retimeAutoSyncSubtitleText(source.rawBody, timeline);
        if (!retimedBody) {
          return false;
        }
        this.subtitleDelayMs = 0;
        this.persistSubtitleDelayPreference();
        const result = await this.applyAssSubtitleBody({
          body: retimedBody,
          selectionToken: this.subtitleSelectionToken
        });
        if (!result?.applied || !isCurrentTarget()) {
          return false;
        }
        this.applySubtitlePresentationSettings({ refreshTrackRendering: true });
        return true;
      }

      const cues = Array.isArray(this.htmlSubtitleCues) ? this.htmlSubtitleCues : [];
      if (String(this.htmlSubtitleSelectedId || "") !== source.subtitleId || !cues.length || cues.length !== timeline.cues.length) {
        return false;
      }
      const retimedCues = cues.map((cue, index) => {
        const retimed = timeline.cues[index];
        return {
          ...cue,
          start: retimed.startTimeMs / 1000,
          end: retimed.endTimeMs / 1000
        };
      });
      for (let index = 0; index < retimedCues.length - 1; index += 1) {
        const current = retimedCues[index];
        const next = retimedCues[index + 1];
        const original = cues[index];
        const originalNext = cues[index + 1];
        if (Number(original?.end) <= Number(originalNext?.start) && current.end > next.start && next.start > current.start) {
          current.end = next.start;
        }
      }
      this.subtitleDelayMs = 0;
      this.persistSubtitleDelayPreference();
      this.htmlSubtitleCues = retimedCues;
      this.htmlSubtitleActiveCueKey = "";
      this.renderHtmlSubtitleOverlayAtCurrentTime();
      this.scheduleHtmlSubtitleOverlayRender();
      this.applySubtitlePresentationSettings({ refreshTrackRendering: true });
      return true;
    },
    maybeRunAutomaticSubtitleSync(subtitle, { source = null, startup = false } = {}) {
      const settings = this.getAutomaticSubtitleSyncSettings();
      if (!settings.enabled || !subtitle?.url) {
        return false;
      }
      if (!Environment.isWebOS() && !Environment.isTizen()) {
        return false;
      }
      if (typeof this.isLivePlayback === "function" && this.isLivePlayback()) {
        return false;
      }
      if (!String(subtitle.lang || subtitle.language || subtitle.languageCode || "").trim()) {
        return false;
      }
      const sourceUrl = String(this.getTrackProbeUrl() || "").trim();
      if (!/^https?:\/\//i.test(sourceUrl)) {
        return false;
      }
      const referenceRequests = this.getSubtitleAutoSyncReferenceRequests(subtitle, settings.thorough);
      if (!referenceRequests.length) {
        // No embedded subtitles to compare with: nothing the viewer can act on.
        return false;
      }
      const addonSource = source || this.currentAddonSubtitleSource;
      if (!addonSource || String(addonSource.subtitleUrl || "") !== String(subtitle.url || "")) {
        return false;
      }
      if (startup) {
        const startupKey = `${sourceUrl}|${subtitle.url}`;
        if (this.automaticSubtitleSyncStartupKey === startupKey) {
          return false;
        }
        this.automaticSubtitleSyncStartupKey = startupKey;
      }

      const runToken = Number(this.automaticSubtitleSyncRunToken || 0) + 1;
      this.automaticSubtitleSyncRunToken = runToken;
      const selectionTokenAtStart = Number(this.subtitleSelectionToken || 0);
      const subtitleUrlAtStart = String(subtitle.url || "");
      const playbackUrlAtStart = String(this.activePlaybackUrl || "");
      const isStillRelevant = () =>
        runToken === Number(this.automaticSubtitleSyncRunToken || 0) &&
        selectionTokenAtStart === Number(this.subtitleSelectionToken || 0) &&
        String(this.selectedAddonSubtitleId || "") === addonSource.subtitleId &&
        String(this.activePlaybackUrl || "") === playbackUrlAtStart &&
        String(this.currentAddonSubtitleSource?.subtitleUrl || "") === subtitleUrlAtStart;

      const run = async () => {
        let targetCues = addonSource.cues;
        if (addonSource.isAss) {
          targetCues = this.parseSubtitleCues(convertAssBodyToVtt(addonSource.rawBody || ""));
        }
        if (!Array.isArray(targetCues) || targetCues.length < 4) {
          return;
        }

        // Let the current subtitle frame commit before the one-shot alignment.
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (!isStillRelevant()) {
          return;
        }

        let bestMatch = null;
        let evaluatedReferences = 0;
        let ambiguousReferences = 0;
        for (const referenceRequest of referenceRequests) {
          let reference;
          try {
            reference = await localMediaEmbeddedSubtitleRepository.getTimeline({
              url: sourceUrl,
              trackNumber: referenceRequest.trackNumber,
              trackOrdinal: referenceRequest.trackOrdinal
            });
          } catch (_) {
            continue;
          }
          if (!isStillRelevant()) {
            return;
          }
          evaluatedReferences += 1;
          // The alignment runs in a Web Worker when the runtime has one, so a
          // long scan does not freeze playback on single-core TVs (issue #1208).
          const candidate = await alignSubtitleAutoSyncAsync({
            referenceCues: reference.cues,
            targetCues: targetCues.map(toAutoSyncTargetCue)
          });
          if (!isStillRelevant()) {
            return;
          }
          if (!candidate?.confident) {
            // A real but ambiguous comparison confirms a no-fit; a null result
            // (too few cues, implausible transform) proves nothing.
            if (candidate) {
              ambiguousReferences += 1;
            }
            if (!settings.thorough) {
              break;
            }
            continue;
          }
          const quality = candidate.activityScore - candidate.averageMatchCost * 0.05;
          if (!bestMatch) {
            bestMatch = { timeline: candidate, quality };
          } else {
            const firstMs = candidate.cues[0].originalStartTimeMs;
            const lastMs = candidate.cues[candidate.cues.length - 1].originalStartTimeMs;
            const disagreement = Math.max(
              Math.abs((candidate.scale - bestMatch.timeline.scale) * firstMs + candidate.interceptMs - bestMatch.timeline.interceptMs),
              Math.abs((candidate.scale - bestMatch.timeline.scale) * lastMs + candidate.interceptMs - bestMatch.timeline.interceptMs)
            );
            const candidateIsTighter = candidate.averageMatchCost < bestMatch.timeline.averageMatchCost;
            if ((disagreement > 300 && candidateIsTighter) || (disagreement <= 300 && quality > bestMatch.quality)) {
              bestMatch = { timeline: candidate, quality };
            }
          }
          if (!settings.thorough) {
            break;
          }
        }

        if (!bestMatch) {
          if (
            isConfirmedAutoSyncNoFit({
              evaluatedReferences,
              ambiguousReferences,
              requestedReferences: referenceRequests.length
            })
          ) {
            this.showAutomaticSubtitleSyncNoFit();
          }
          return;
        }

        const timeline = bestMatch.timeline;
        if (settings.toleranceMs > 0 && timeline.maxShiftMs <= settings.toleranceMs) {
          this.markSubtitleAutoSynced(subtitle);
          return;
        }

        const applied = await this.applyAutomaticSubtitleSyncTimeline({
          subtitle,
          source: addonSource,
          timeline
        });
        if (!applied || !isStillRelevant()) {
          return;
        }
        this.markSubtitleAutoSynced(subtitle);
      };

      if (this.automaticSubtitleSyncTimer) {
        clearTimeout(this.automaticSubtitleSyncTimer);
      }
      this.automaticSubtitleSyncTimer = setTimeout(() => {
        this.automaticSubtitleSyncTimer = null;
        void run();
      }, 0);
      return true;
    }
  };
}
