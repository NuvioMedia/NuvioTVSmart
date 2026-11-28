/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";
import { buildMuteRanges, createProfanityMatcher, maskProfanity, muteRangesForCue } from "../../../core/player/profanityFilter.js";
import { ProfanityMuteController, createProfanityMuteDriver } from "../../../core/player/profanityMuteController.js";
import { resolveTitleContentRating } from "../../../core/player/profanityRatingResolver.js";
import { ProfanityFilterStore, normalizeTitleKey, resolveProfanityFilterForTitle } from "../../../data/local/profanityFilterStore.js";

// Wait for the startup subtitle choice before loading a hidden subtitle just
// for mute timing.
const SHADOW_SUBTITLE_DELAY_MS = 3500;
const INDICATOR_HIDE_DELAY_MS = 900;

function isEnglishSubtitle(subtitle = {}) {
  const language = String(subtitle?.lang || subtitle?.language || subtitle?.languageCode || "")
    .trim()
    .toLowerCase();
  return language === "en" || language === "eng" || language.startsWith("en-") || language.startsWith("english");
}

/**
 * Masks the text segments of ASS "Dialogue:" events, leaving override tags
 * ({\an8}) and line breaks (\N) untouched.
 */
export function maskAssSubtitleBody(body, matcher, style, options = {}) {
  return String(body || "").replace(/^(Dialogue:\s*(?:[^,]*,){9})(.*)$/gim, (line, head, text) => {
    const masked = String(text || "")
      .split(/(\{[^}]*\}|\\[Nnh])/)
      .map((segment) => (/^\{[^}]*\}$|^\\[Nnh]$/.test(segment) ? segment : maskProfanity(segment, matcher, style, options)))
      .join("");
    return head + masked;
  });
}

export function createPlayerScreenMethods78() {
  const { PlayerController, Environment, isAssSubtitle, convertAssBodyToVtt, dbToGain, t } = internals;

  return {
    getProfanityTitleIdentity() {
      const params = this.params || {};
      const titleKey = normalizeTitleKey(params.itemId || params.imdbId || params.videoId || "");
      return {
        titleKey,
        name: String(params.playerTitle || params.itemTitle || params.title || "").trim(),
        itemId: String(params.itemId || ""),
        itemType: String(params.itemType || ""),
        imdbId: String(params.imdbId || ""),
        tmdbId: String(params.tmdbId || ""),
        knownRating: String(params.ageRating || params.contentRating || "")
      };
    },

    initProfanityFilter() {
      this.destroyProfanityFilter();
      this.profanityMuteFailure = null;
      // Off (the default): no listeners, timers, rating lookups or subtitle
      // changes at all.
      if (!ProfanityFilterStore.get().enabled) {
        return;
      }
      const identity = this.getProfanityTitleIdentity();
      this.profanityFilter = {
        identity,
        rating: "",
        decision: { enabled: false, reason: "unrated", rating: "" },
        settings: ProfanityFilterStore.get(),
        matcher: null,
        rangesSource: null,
        rangesFromShadow: false,
        // "subtitle": cue times need the subtitle delay applied (HTML overlay,
        // ASS). "media": already on the media clock (native text tracks carry
        // the delay in their cue times; the hidden timing subtitle has none).
        rangesClock: "subtitle",
        nativeKey: "",
        shadowCues: null,
        shadowToken: 0,
        token: Number(this.playerMountToken || 0)
      };
      this.profanityMuteController = new ProfanityMuteController({
        driver: createProfanityMuteDriver({
          // AVPlay draws outside the <video> element, so muting the element
          // would do nothing. Trust AVPlay's own state as well as the engine
          // flag, which can lag during source switches.
          isUsingAvPlay: () => {
            if (!Environment.isTizen()) return false;
            if (PlayerController.isUsingAvPlay?.()) return true;
            try {
              const state = String(PlayerController.getAvPlay?.()?.getState?.() || "");
              return ["READY", "PLAYING", "PAUSED"].includes(state);
            } catch (_) {
              return false;
            }
          },
          getVideo: () => PlayerController.video,
          getGainNode: () => this.audioGainNode || null,
          getGainValue: () => dbToGain(Number(this.audioAmplificationDb || 0))
        }),
        getSubtitleTime: () => {
          const delaySeconds = this.profanityFilter?.rangesClock === "media" ? 0 : Number(this.subtitleDelayMs || 0) / 1000;
          return Number(this.getPlaybackCurrentSeconds() || 0) - delaySeconds;
        },
        getPlaybackRate: () => Number(this.getPlaybackSpeed?.() || 1),
        isPlaying: () =>
          Boolean(!document.hidden && !this.paused && PlayerController.isPlaying !== false && this.hasPresentedPlaybackFrame),
        onMuteChange: (muted) => this.renderProfanityIndicator(muted),
        onMuteFailed: (reason) => this.reportProfanityMuteFailure(reason)
      });
      // The Samsung player mutes the whole TV: never leave it muted when the
      // app is hidden (Home button, input switch) or closed mid-word.
      this.profanityVisibilityHandler = () => {
        if (document.hidden) {
          this.profanityMuteController?.applyMuted(false);
        } else {
          this.profanityMuteController?.sync();
        }
      };
      this.profanityPageHideHandler = () => this.profanityMuteController?.applyMuted(false);
      document.addEventListener("visibilitychange", this.profanityVisibilityHandler);
      window.addEventListener("pagehide", this.profanityPageHideHandler);
      window.addEventListener("beforeunload", this.profanityPageHideHandler);
      this.refreshProfanityFilterDecision();
      const mountToken = this.playerMountToken;
      void resolveTitleContentRating(identity).then((rating) => {
        if (!this.profanityFilter || mountToken !== this.playerMountToken) {
          return;
        }
        this.profanityFilter.rating = rating || "";
        this.refreshProfanityFilterDecision();
      });
    },

    /** Re-reads settings and the per-title choice; call after any change. */
    refreshProfanityFilterDecision() {
      const state = this.profanityFilter;
      if (!state) {
        return;
      }
      state.settings = ProfanityFilterStore.get();
      state.decision = resolveProfanityFilterForTitle({
        titleKey: state.identity.titleKey,
        rating: state.rating || state.identity.knownRating,
        settings: state.settings
      });
      state.matcher = state.decision.enabled
        ? createProfanityMatcher({
            categories: state.settings.categories,
            customWords: state.settings.customWords,
            allowedWords: state.settings.allowedWords
          })
        : null;
      state.rangesSource = null;
      // Masking needs the subtitle text in JS: render AVPlay subtitles through
      // the HTML overlay instead of the native renderer for filtered titles.
      if (this.shouldMaskProfanity()) {
        this.subtitleRenderMode = "html";
      }
      this.htmlSubtitleActiveCueKey = null;
      state.nativeKey = "";
      try {
        this.refreshSubtitleCueStyles?.();
      } catch (_) {
        // Native tracks are optional; the HTML overlay is refreshed below.
      }
      if (Array.isArray(this.htmlSubtitleLastActiveCues)) {
        this.renderHtmlSubtitleOverlayCue(this.htmlSubtitleLastActiveCues);
      }
      this.profanityMuteController?.setEnabled(this.shouldMuteProfanity());
      this.syncProfanityMuteRanges();
      if (this.shouldMuteProfanity()) {
        this.scheduleProfanityShadowSubtitle();
      }
    },

    isProfanityFilterActive() {
      return Boolean(this.profanityFilter?.decision?.enabled && this.profanityFilter.matcher);
    },

    shouldMaskProfanity() {
      return this.isProfanityFilterActive() && this.profanityFilter.settings.action !== "mute";
    },

    shouldMuteProfanity() {
      return this.isProfanityFilterActive() && this.profanityFilter.settings.action !== "mask";
    },

    /** Display-time masking for HTML overlay cues. */
    maskProfanityInCues(cues = []) {
      if (!this.shouldMaskProfanity() || !Array.isArray(cues) || !cues.length) {
        return cues;
      }
      const { matcher, settings } = this.profanityFilter;
      return cues
        .map((cue) => ({
          ...cue,
          text: maskProfanity(cue.text || "", matcher, settings.maskStyle, { showFirstLetter: settings.showFirstLetter })
        }))
        .filter((cue) => String(cue.text || "").trim());
    },

    getProfanityCueKey() {
      if (!this.isProfanityFilterActive()) {
        return "";
      }
      return `pf:${this.profanityFilter.settings.maskStyle}:${this.profanityFilter.settings.showFirstLetter ? 1 : 0}:${this.profanityFilter.matcher.key}:${this.profanityFilter.settings.action}`;
    },

    prepareAssBodyForProfanityFilter(body) {
      if (!this.isProfanityFilterActive()) {
        return body;
      }
      try {
        this.profanityFilter.assCues = this.parseSubtitleCues(convertAssBodyToVtt(body));
        this.profanityFilter.rangesSource = null;
        this.syncProfanityMuteRanges();
      } catch (_) {
        this.profanityFilter.assCues = null;
      }
      if (!this.shouldMaskProfanity()) {
        return body;
      }
      return maskAssSubtitleBody(body, this.profanityFilter.matcher, this.profanityFilter.settings.maskStyle, {
        showFirstLetter: this.profanityFilter.settings.showFirstLetter
      });
    },

    /**
     * Picks the cue list that drives look-ahead muting: the subtitle being
     * shown, else the ASS track, else the hidden timing subtitle.
     */
    syncProfanityMuteRanges() {
      const state = this.profanityFilter;
      const controller = this.profanityMuteController;
      if (!state || !controller) {
        return;
      }
      if (!this.shouldMuteProfanity()) {
        state.rangesSource = null;
        controller.setRanges([]);
        return;
      }
      const shown = Array.isArray(this.htmlSubtitleCues) && this.htmlSubtitleCues.length ? this.htmlSubtitleCues : null;
      const ass = this.isAssAddonSubtitleActive?.() && Array.isArray(state.assCues) && state.assCues.length ? state.assCues : null;
      let native = null;
      if (!shown && !ass) {
        // Native text tracks (browser, LG webOS native/HLS, Samsung HTML5):
        // the TV renders them, but the cues are readable for look-ahead.
        const snapshot = this.getProfanityNativeCues();
        if (snapshot) {
          if (snapshot.key === state.nativeKey && state.rangesSource === state.nativeCues) {
            return;
          }
          state.nativeKey = snapshot.key;
          state.nativeCues = snapshot.cues;
          native = snapshot.cues;
        }
      }
      const source = shown || ass || native || state.shadowCues || null;
      if (source === state.rangesSource) {
        return;
      }
      state.rangesSource = source;
      state.rangesFromShadow = Boolean(source && source === state.shadowCues);
      state.rangesClock = source && (source === native || source === state.shadowCues) ? "media" : "subtitle";
      controller.setRanges(
        source
          ? buildMuteRanges(source, state.matcher, {
              precision: state.settings.mutePrecision,
              paddingMs: state.settings.mutePaddingMs
            })
          : []
      );
    },

    /**
     * Cues of the native text track being shown, with their original text (the
     * cue itself may already be censored) and delay-adjusted times. The key
     * changes when cues load, the delay moves or the track changes.
     */
    getProfanityNativeCues() {
      const track = (this.getSubtitleCueTrackList?.() || []).find((item) => item && item.mode === "showing");
      const cues = track ? this.getSubtitleCueArray(track.cues) : [];
      if (!cues.length) {
        return null;
      }
      const first = cues[0];
      const last = cues[cues.length - 1];
      const key = `${track.id || track.label || ""}:${track.language || ""}:${cues.length}:${first.startTime}:${last.endTime}`;
      if (key === this.profanityFilter?.nativeKey) {
        return { key, cues: this.profanityFilter.nativeCues };
      }
      return {
        key,
        cues: cues.map((cue) => ({
          start: Number(cue.startTime),
          end: Number(cue.endTime),
          text: String(this.getSubtitleCueSnapshot?.(cue)?.text ?? cue.text ?? "")
        }))
      };
    },

    /** Censors one subtitle string (native text-track cues). */
    maskProfanityText(text) {
      if (!this.shouldMaskProfanity()) {
        return text;
      }
      const { matcher, settings } = this.profanityFilter;
      return maskProfanity(text, matcher, settings.maskStyle, { showFirstLetter: settings.showFirstLetter });
    },

    syncProfanityMute() {
      if (!this.profanityMuteController) {
        return;
      }
      this.syncProfanityMuteRanges();
      this.profanityMuteController.sync();
    },

    /**
     * AVPlay subtitle callbacks only reveal a cue when it is shown. Mute
     * around the filtered words from now on, like the caption-watching
     * browser extensions do.
     */
    handleProfanityLiveCue(text, durationMs) {
      if (!this.shouldMuteProfanity() || !this.profanityMuteController) {
        return;
      }
      // A look-ahead list from the same track already covers this cue.
      if (this.profanityFilter.rangesSource && !this.profanityFilter.rangesFromShadow) {
        return;
      }
      const duration = Math.max(0.25, Math.min(12, Number(durationMs || 0) / 1000 || 2.5));
      const ranges = muteRangesForCue({ start: 0, end: duration, text }, this.profanityFilter.matcher, {
        precision: this.profanityFilter.settings.mutePrecision,
        paddingMs: this.profanityFilter.settings.mutePaddingMs
      });
      if (!ranges.length) {
        return;
      }
      this.profanityMuteController.muteLive(
        ranges.map((range) => ({ startMs: Math.max(0, range.start * 1000), endMs: Math.max(0, range.end * 1000) }))
      );
    },

    scheduleProfanityShadowSubtitle() {
      const state = this.profanityFilter;
      if (!state || !state.settings.muteWithoutSubtitles || !this.shouldMuteProfanity()) {
        return;
      }
      clearTimeout(this.profanityShadowTimer);
      const token = (state.shadowToken = Number(state.shadowToken || 0) + 1);
      this.profanityShadowTimer = setTimeout(() => {
        this.profanityShadowTimer = null;
        void this.loadProfanityShadowSubtitle(token);
      }, SHADOW_SUBTITLE_DELAY_MS);
    },

    /**
     * When subtitles are off, load the best English addon subtitle without
     * showing it, so filtered words can still be muted.
     */
    async loadProfanityShadowSubtitle(token) {
      const state = this.profanityFilter;
      if (!state || token !== state.shadowToken || !this.shouldMuteProfanity()) {
        return;
      }
      const candidates = (Array.isArray(this.subtitles) ? this.subtitles : []).filter((subtitle) => subtitle?.url);
      const subtitle = candidates.find(isEnglishSubtitle) || null;
      if (!subtitle) {
        return;
      }
      const mountToken = this.playerMountToken;
      try {
        const raw = await this.fetchSubtitleRawBody(String(subtitle.url), {
          languageHint: subtitle.lang || subtitle.language || subtitle.languageCode,
          subtitleHeaders: subtitle.headers
        });
        if (!this.profanityFilter || token !== this.profanityFilter.shadowToken || mountToken !== this.playerMountToken) {
          return;
        }
        const body = String(raw?.body || "");
        const cues = isAssSubtitle(body, { sourceUrl: subtitle.url, contentType: raw?.contentType })
          ? this.parseSubtitleCues(convertAssBodyToVtt(body))
          : this.parseSubtitleCues(body);
        if (!cues.length) {
          return;
        }
        this.profanityFilter.shadowCues = cues;
        this.profanityFilter.rangesSource = null;
        this.syncProfanityMute();
      } catch (error) {
        console.warn("Profanity filter timing subtitle failed", error?.message || String(error || ""));
      }
    },

    resetProfanityShadowSubtitle() {
      if (this.profanityFilter) {
        this.profanityFilter.shadowCues = null;
        this.profanityFilter.assCues = null;
        this.profanityFilter.rangesSource = null;
        this.profanityFilter.shadowToken = Number(this.profanityFilter.shadowToken || 0) + 1;
      }
      clearTimeout(this.profanityShadowTimer);
      this.profanityShadowTimer = null;
    },

    /**
     * A failed mute used to be silent. Say so once per playback, with the
     * reason, so a TV that refuses the mute can be diagnosed from the couch.
     */
    reportProfanityMuteFailure(reason) {
      const text = String(reason || "");
      if (this.profanityMuteFailure === text) {
        return;
      }
      this.profanityMuteFailure = text;
      console.warn("Profanity filter could not mute", text);
      // The user muted the TV on purpose: nothing to report.
      if (/already muted|already 0/i.test(text)) {
        return;
      }
      this.showAspectToast(
        t("profanity_mute_failed", [text], `Profanity filter couldn't mute this TV (${text || "unknown reason"})`),
        6000
      );
      this.renderAudioDialog?.();
    },

    renderProfanityIndicator(muted) {
      const node = this.uiRefs?.profanityIndicator || document.getElementById("playerProfanityIndicator");
      if (!node) {
        return;
      }
      clearTimeout(this.profanityIndicatorTimer);
      const visible = Boolean(muted && this.profanityFilter?.settings?.showIndicator);
      if (visible) {
        node.classList.remove("hidden");
        node.setAttribute("aria-hidden", "false");
        return;
      }
      // Linger briefly so back-to-back words do not flicker the pill.
      this.profanityIndicatorTimer = setTimeout(() => {
        node.classList.add("hidden");
        node.setAttribute("aria-hidden", "true");
      }, INDICATOR_HIDE_DELAY_MS);
    },

    /** One-line status used by the audio panel toggle. */
    getProfanityFilterStatusLabel() {
      if (this.profanityMuteFailure && this.profanityFilter?.decision?.enabled && !/already/i.test(this.profanityMuteFailure)) {
        return t("profanity_status_mute_failed", [this.profanityMuteFailure], `Can't mute: ${this.profanityMuteFailure}`);
      }
      const decision = this.profanityFilter?.decision || { enabled: false, reason: "unrated" };
      const rating = decision.rating ? ` · ${decision.rating}` : "";
      switch (decision.reason) {
        case "title_on":
        case "title_off":
          return t("profanity_status_title", {}, "Set for this title") + rating;
        case "always":
          return t("profanity_status_always", {}, "On for everything");
        case "manual":
          return t("profanity_status_manual", {}, "Off for this title");
        case "rating":
          return t("profanity_status_rating", {}, "Auto: mature rating") + rating;
        case "rating_skip":
          return t("profanity_status_rating_skip", {}, "Auto: not a mature rating") + rating;
        default:
          return t("profanity_status_unrated", {}, "Rating unknown · turn on for this title");
      }
    },

    toggleProfanityFilterForTitle() {
      const state = this.profanityFilter;
      if (!state?.identity?.titleKey) {
        this.showAspectToast(t("profanity_toast_unavailable", {}, "Profanity filter unavailable for this video"), 1800);
        return;
      }
      const nextEnabled = !state.decision.enabled;
      ProfanityFilterStore.setTitleOverride(state.identity.titleKey, nextEnabled, { name: state.identity.name });
      this.refreshProfanityFilterDecision();
      // The AVPlay native renderer may be drawing the track: re-apply the
      // current selection so it moves to the HTML overlay and gets masked.
      if (nextEnabled && Environment.isTizen() && PlayerController.isUsingAvPlay?.() && Number(this.selectedSubtitleTrackIndex) >= 0) {
        try {
          PlayerController.setAvPlaySubtitleTrack?.(Number(this.selectedSubtitleTrackIndex), { renderMode: "html" });
        } catch (_) {
          // Keep the current renderer; masking resumes on the next selection.
        }
      }
      this.showAspectToast(
        nextEnabled
          ? t("profanity_toast_on", {}, "Profanity filter on for this title")
          : t("profanity_toast_off", {}, "Profanity filter off for this title"),
        1800
      );
      this.renderAudioDialog();
    },

    destroyProfanityFilter() {
      if (this.profanityVisibilityHandler) {
        document.removeEventListener("visibilitychange", this.profanityVisibilityHandler);
        this.profanityVisibilityHandler = null;
      }
      if (this.profanityPageHideHandler) {
        window.removeEventListener("pagehide", this.profanityPageHideHandler);
        window.removeEventListener("beforeunload", this.profanityPageHideHandler);
        this.profanityPageHideHandler = null;
      }
      clearTimeout(this.profanityShadowTimer);
      clearTimeout(this.profanityIndicatorTimer);
      this.profanityShadowTimer = null;
      this.profanityIndicatorTimer = null;
      if (this.profanityMuteController) {
        this.profanityMuteController.destroy();
        this.profanityMuteController = null;
      }
      this.profanityFilter = null;
    }
  };
}
