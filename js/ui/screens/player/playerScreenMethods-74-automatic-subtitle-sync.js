/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";
import { AUTO_SYNC_TOLERANCE_OPTIONS_MS } from "../../../core/player/subtitleAutoSyncEngine.js";
import { alignSubtitleAutoSyncAsync } from "../../../core/player/subtitleAutoSyncWorkerClient.js";
import { retimeAutoSyncSubtitleText } from "../../../core/player/subtitleAutoSyncRetimer.js";
import { confirmsAutoSyncNoFit, isConfirmedAutoSyncNoFit } from "../../../core/player/autosyncOutcome.js";

const AUTO_SYNC_TOAST_MS = 2200;
// Android EXCEPTIONAL_MATCH_TARGET_COVERAGE / _REFERENCE_COVERAGE: a match this complete
// ends the search for a better same-language subtitle.
const EXCEPTIONAL_TARGET_COVERAGE = 0.99;
const EXCEPTIONAL_REFERENCE_COVERAGE = 0.97;

function autoSyncMatchQuality(match) {
  return match.activityScore - match.averageMatchCost * 0.05;
}

function isExceptionalAutoSyncMatch(match) {
  return Boolean(
    match?.confident && match.targetCoverage >= EXCEPTIONAL_TARGET_COVERAGE && match.referenceCoverage >= EXCEPTIONAL_REFERENCE_COVERAGE
  );
}

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
    isAssSubtitle,
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
        this.automaticSubtitleSyncResolved = null;
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
    /** The same-language add-on subtitles AutoSync may weigh against the picked one. */
    getAutoSyncAlternativeSubtitles(subtitle) {
      const languageKey = normalizeSubtitleLanguageKey(subtitle.lang || subtitle.language || subtitle.languageCode || "");
      const seen = new Set([String(subtitle.url || "")]);
      return (Array.isArray(this.subtitles) ? this.subtitles : []).filter((entry) => {
        const url = String(entry?.url || "");
        if (!url || seen.has(url)) return false;
        seen.add(url);
        return normalizeSubtitleLanguageKey(entry.lang || entry.language || entry.languageCode || "") === languageKey;
      });
    },
    async loadAutoSyncCandidateCues(candidate) {
      try {
        const raw = await this.fetchSubtitleRawBody(candidate.url, {
          languageHint: candidate.lang || candidate.language || candidate.languageCode || ""
        });
        const body = String(raw?.body || "");
        const isAss = isAssSubtitle(body, { sourceUrl: candidate.url, contentType: raw?.contentType });
        return this.parseSubtitleCues(isAss ? convertAssBodyToVtt(body) : body);
      } catch (_) {
        return [];
      }
    },
    /** Android: picking an alternative also makes it the selected (and remembered) subtitle. */
    switchToAutoSyncAlternative(candidate) {
      const option = this.collectSubtitleOptionItems?.().find((entry) => entry?.entry?.track?.url === candidate.url);
      if (!option) {
        return false;
      }
      this.selectSubtitleOption(option, { focusOptions: false });
      return true;
    },
    /**
     * Android maybeRunAutomaticSubtitleSync scopes:
     * - "startup" (STARTUP_SEARCH): the auto-selected subtitle and every same-language
     *   add-on subtitle are weighed on equal terms; the best fit is used.
     * - "restored" (SELECTED_THEN_SEARCH): the series preference is checked first and
     *   kept when it fits; only otherwise the full search runs.
     * - "selected" (SELECTED_ONLY): a manual pick is only synced, never swapped.
     */
    maybeRunAutomaticSubtitleSync(subtitle, { source = null, scope = "selected" } = {}) {
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
      // Android claims the start-up search once per stream.
      if (scope === "startup") {
        if (this.automaticSubtitleSyncStartupKey === sourceUrl) {
          return false;
        }
        this.automaticSubtitleSyncStartupKey = sourceUrl;
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

      const applyTimeline = async (timeline) => {
        if (settings.toleranceMs > 0 && timeline.maxShiftMs <= settings.toleranceMs) {
          this.markSubtitleAutoSynced(subtitle);
          return;
        }
        const applied = await this.applyAutomaticSubtitleSyncTimeline({ subtitle, source: addonSource, timeline });
        if (applied && isStillRelevant()) {
          this.markSubtitleAutoSynced(subtitle);
        }
      };

      const run = async () => {
        // Android resolvedCache: a result found for this stream and subtitle (e.g. the
        // alternative a start-up search just switched to) is reused, not analysed again.
        const cached = this.automaticSubtitleSyncResolved;
        if (cached?.sourceUrl === sourceUrl && cached.subtitleUrl === subtitleUrlAtStart) {
          await applyTimeline(cached.timeline);
          return;
        }
        let selectedCues = addonSource.cues;
        if (addonSource.isAss) {
          selectedCues = this.parseSubtitleCues(convertAssBodyToVtt(addonSource.rawBody || ""));
        }
        // Let the current subtitle frame commit before the one-shot alignment.
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (!isStillRelevant()) {
          return;
        }

        // Embedded references load once and are shared by every candidate.
        const references = [];
        let nextReferenceIndex = 0;
        const referenceAt = async (index) => {
          while (references.length <= index && nextReferenceIndex < referenceRequests.length) {
            const request = referenceRequests[nextReferenceIndex];
            nextReferenceIndex += 1;
            try {
              references.push(
                await localMediaEmbeddedSubtitleRepository.getTimeline({
                  url: sourceUrl,
                  trackNumber: request.trackNumber,
                  trackOrdinal: request.trackOrdinal
                })
              );
            } catch (_) {
              // An unreadable reference is skipped, like before.
            }
          }
          return references[index] || null;
        };

        const evaluate = async (cues) => {
          const outcome = { bestMatch: null, evaluated: 0, ambiguous: 0 };
          if (!Array.isArray(cues) || cues.length < 4) {
            return outcome;
          }
          const targetCues = cues.map(toAutoSyncTargetCue);
          for (let index = 0; ; index += 1) {
            const reference = await referenceAt(index);
            if (!reference || !isStillRelevant()) {
              break;
            }
            outcome.evaluated += 1;
            // The alignment runs in a Web Worker when the runtime has one, so a
            // long scan does not freeze playback on single-core TVs (issue #1208).
            const candidate = await alignSubtitleAutoSyncAsync({ referenceCues: reference.cues, targetCues });
            if (!isStillRelevant()) {
              break;
            }
            if (!candidate?.confident) {
              // Only a clearly ambiguous comparison confirms a no-fit; a null result
              // or a real but weak match proves nothing.
              if (confirmsAutoSyncNoFit(candidate)) {
                outcome.ambiguous += 1;
              }
            } else {
              const quality = autoSyncMatchQuality(candidate);
              const best = outcome.bestMatch;
              if (!best) {
                outcome.bestMatch = { timeline: candidate, quality };
              } else {
                const firstMs = candidate.cues[0].originalStartTimeMs;
                const lastMs = candidate.cues[candidate.cues.length - 1].originalStartTimeMs;
                const disagreement = Math.max(
                  Math.abs((candidate.scale - best.timeline.scale) * firstMs + candidate.interceptMs - best.timeline.interceptMs),
                  Math.abs((candidate.scale - best.timeline.scale) * lastMs + candidate.interceptMs - best.timeline.interceptMs)
                );
                const candidateIsTighter = candidate.averageMatchCost < best.timeline.averageMatchCost;
                if ((disagreement > 300 && candidateIsTighter) || (disagreement <= 300 && quality > best.quality)) {
                  outcome.bestMatch = { timeline: candidate, quality };
                }
              }
            }
            if (!settings.thorough) {
              break;
            }
          }
          return outcome;
        };

        const selectedOutcome = await evaluate(selectedCues);
        if (!isStillRelevant()) {
          return;
        }
        let winner = selectedOutcome.bestMatch ? { subtitle, match: selectedOutcome.bestMatch } : null;
        const searchAll =
          (scope === "startup" || (scope === "restored" && !winner)) &&
          // Nothing in the video to compare with: other subtitles cannot fit either.
          references.length > 0 &&
          !isExceptionalAutoSyncMatch(winner?.match?.timeline);
        if (searchAll) {
          for (const candidate of this.getAutoSyncAlternativeSubtitles(subtitle)) {
            const outcome = await evaluate(await this.loadAutoSyncCandidateCues(candidate));
            if (!isStillRelevant()) {
              return;
            }
            const match = outcome.bestMatch;
            if (match && (!winner || match.quality > winner.match.quality)) {
              winner = { subtitle: candidate, match };
              // Android stops searching once a match is exceptional.
              if (isExceptionalAutoSyncMatch(match.timeline)) {
                break;
              }
            }
          }
        }

        if (!winner) {
          if (
            isConfirmedAutoSyncNoFit({
              evaluatedReferences: selectedOutcome.evaluated,
              ambiguousReferences: selectedOutcome.ambiguous,
              requestedReferences: referenceRequests.length
            })
          ) {
            this.showAutomaticSubtitleSyncNoFit();
          }
          return;
        }
        if (winner.subtitle === subtitle) {
          await applyTimeline(winner.match.timeline);
          return;
        }
        // The best fit is another subtitle: select it; its run reuses this result.
        this.automaticSubtitleSyncResolved = {
          sourceUrl,
          subtitleUrl: String(winner.subtitle.url),
          timeline: winner.match.timeline
        };
        console.info("AutoSync: a same-language subtitle fits better, switching to it");
        this.switchToAutoSyncAlternative(winner.subtitle);
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
