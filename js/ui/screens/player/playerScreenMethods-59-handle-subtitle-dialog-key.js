/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods59() {
  const { isSelectKeyCode, SUBTITLE_LANGUAGE_OFF_KEY, getAudioTrackSupportState, formatAudioTrackDisplay, clamp } = internals;

  return {
    handleSubtitleDialogKey(event) {
      const keyCode = Number(event?.keyCode || 0);
      const languages = this.getSubtitleLanguageRailItems();
      const selectedLanguageKey = this.getSelectedSubtitleLanguageKey();
      const options = this.getSubtitleOptionsForLanguage(selectedLanguageKey);
      const styleItems = this.getSubtitleStyleControls();
      const styleItem = styleItems[this.subtitleStyleRailIndex];

      if (keyCode === 38) {
        if (this.subtitleFocusedRail === "language") {
          this.subtitleLanguageRailIndex = clamp(this.subtitleLanguageRailIndex - 1, 0, Math.max(0, languages.length - 1));
          this.subtitleFocusedLanguageKey = languages[this.subtitleLanguageRailIndex]?.key || SUBTITLE_LANGUAGE_OFF_KEY;
        } else if (this.subtitleFocusedRail === "options") {
          this.subtitleOptionRailIndex = clamp(this.subtitleOptionRailIndex - 1, 0, Math.max(0, options.length - 1));
          this.rememberSubtitleOptionFocus(selectedLanguageKey, options, this.subtitleOptionRailIndex);
        } else {
          this.subtitleStyleRailIndex = clamp(this.subtitleStyleRailIndex - 1, 0, Math.max(0, styleItems.length - 1));
        }
        if (!this.syncSubtitleDialogFocusDom()) {
          this.renderSubtitleDialog();
        }
        return true;
      }
      if (keyCode === 40) {
        if (this.subtitleFocusedRail === "language") {
          this.subtitleLanguageRailIndex = clamp(this.subtitleLanguageRailIndex + 1, 0, Math.max(0, languages.length - 1));
          this.subtitleFocusedLanguageKey = languages[this.subtitleLanguageRailIndex]?.key || SUBTITLE_LANGUAGE_OFF_KEY;
        } else if (this.subtitleFocusedRail === "options") {
          this.subtitleOptionRailIndex = clamp(this.subtitleOptionRailIndex + 1, 0, Math.max(0, options.length - 1));
          this.rememberSubtitleOptionFocus(selectedLanguageKey, options, this.subtitleOptionRailIndex);
        } else {
          this.subtitleStyleRailIndex = clamp(this.subtitleStyleRailIndex + 1, 0, Math.max(0, styleItems.length - 1));
        }
        if (!this.syncSubtitleDialogFocusDom()) {
          this.renderSubtitleDialog();
        }
        return true;
      }
      if (keyCode === 37) {
        if (this.subtitleFocusedRail === "style") {
          if (styleItem?.id === "delay" && !styleItem.disabled) {
            this.subtitleFocusedRail = options.length ? "options" : "language";
            this.subtitleStyleControlSide = "minus";
            if (!this.syncSubtitleDialogFocusDom()) {
              this.renderSubtitleDialog();
            }
            return true;
          }
          if (this.subtitleStyleControlSide === "plus") {
            this.subtitleStyleControlSide = "minus";
            this.syncSubtitleDialogFocusDom();
            return true;
          } else {
            this.subtitleFocusedRail = options.length ? "options" : "language";
            this.subtitleStyleControlSide = "minus";
            if (!this.syncSubtitleDialogFocusDom()) {
              this.renderSubtitleDialog();
            }
            return true;
          }
        } else if (this.subtitleFocusedRail === "options") {
          this.subtitleFocusedRail = "language";
          if (!this.syncSubtitleDialogFocusDom()) {
            this.renderSubtitleDialog();
          }
          return true;
        }
        return true;
      }
      if (keyCode === 39) {
        if (this.subtitleFocusedRail === "language" && selectedLanguageKey !== SUBTITLE_LANGUAGE_OFF_KEY && options.length) {
          this.subtitleFocusedRail = "options";
          if (!this.syncSubtitleDialogFocusDom()) {
            this.renderSubtitleDialog();
          }
          return true;
        }
        if (this.subtitleFocusedRail === "options") {
          this.subtitleFocusedRail = "style";
          this.subtitleStyleControlSide = "minus";
          if (!this.syncSubtitleDialogFocusDom()) {
            this.renderSubtitleDialog();
          }
          return true;
        }
        if (this.subtitleFocusedRail === "style") {
          if (styleItem?.id === "delay" && !styleItem.disabled) {
            return true;
          }
          if (this.subtitleStyleControlSide === "minus") {
            this.subtitleStyleControlSide = "plus";
            this.syncSubtitleDialogFocusDom();
            return true;
          }
        }
        return true;
      }
      if (isSelectKeyCode(keyCode)) {
        if (this.subtitleFocusedRail === "language") {
          const language = languages[this.subtitleLanguageRailIndex];
          if (!language) {
            return true;
          }
          if (language.key === SUBTITLE_LANGUAGE_OFF_KEY) {
            const offEntry = this.getSubtitleEntries("builtIn").find((entry) => entry.id === "subtitle-off") || {
              trackIndex: -1
            };
            this.applySubtitleEntry(offEntry);
            this.rememberSubtitleTrackSelection({
              sourceType: "off",
              languageKey: SUBTITLE_LANGUAGE_OFF_KEY,
              entry: offEntry
            });
          } else {
            const selected = this.selectFirstSubtitleOptionForLanguage(language.key, {
              focusOptions: true
            });
            if (!selected) {
              const nextOptions = this.getSubtitleOptionsForLanguage(language.key);
              if (nextOptions.length) {
                this.subtitleFocusedRail = "options";
                this.subtitleOptionRailIndex = 0;
              }
            }
          }
          this.renderSubtitleDialog();
          return true;
        }
        if (this.subtitleFocusedRail === "options") {
          const option = options[this.subtitleOptionRailIndex];
          if (option?.entry) {
            this.selectSubtitleOption(option);
          }
          return true;
        }
        if (styleItem?.id === "delay" && !styleItem.disabled) {
          this.showSubtitleDelayOverlay();
          return true;
        }
        if (styleItem && !styleItem.disabled) {
          this.adjustSubtitleStyleControl(styleItem.id, this.getSubtitleStyleControlDelta(this.subtitleStyleControlSide), {
            isRepeat: Boolean(event?.repeat)
          });
        }
        return true;
      }
      if (this.subtitleFocusedRail === "style" && (keyCode === 10009 || keyCode === 461)) {
        this.subtitleFocusedRail = options.length ? "options" : "language";
        this.subtitleStyleControlSide = "minus";
        if (!this.syncSubtitleDialogFocusDom()) {
          this.renderSubtitleDialog();
        }
        return true;
      }
      return keyCode === 37 || keyCode === 38 || keyCode === 39 || keyCode === 40 || isSelectKeyCode(keyCode);
    },
    getMergedAudioTrackEntries(audioTracks = []) {
      const entries = [];
      const representedEmbeddedIndexes = new Set();

      audioTracks.forEach((track, index) => {
        const embeddedTrack = this.getEmbeddedAudioTrackByNativeIndex(index) || this.getEmbeddedAudioTrack(index);
        const embeddedTrackIndex = Number(embeddedTrack?.embeddedTrackIndex);
        if (Number.isFinite(embeddedTrackIndex) && embeddedTrackIndex >= 0) {
          representedEmbeddedIndexes.add(embeddedTrackIndex);
        }

        const mergedTrack = this.mergeEmbeddedAudioTrackMetadata(track, index);
        const support = getAudioTrackSupportState(mergedTrack);
        const display = formatAudioTrackDisplay(mergedTrack, index);
        entries.push({
          id: `audio-track-${index}`,
          label: display.label,
          secondary: display.secondary,
          languageText: display.languageText,
          metadata: display.metadata,
          selected:
            Number.isFinite(embeddedTrackIndex) && this.selectedEmbeddedAudioTrackIndex >= 0
              ? embeddedTrackIndex === this.selectedEmbeddedAudioTrackIndex
              : index === this.selectedAudioTrackIndex,
          supported: support.supported,
          canTryAudioConversion: Boolean(support.canTryAudioConversion),
          unsupportedReason: support.unsupportedReason,
          audioTrackIndex: index,
          track: {
            ...mergedTrack,
            ...support
          }
        });
      });

      this.embeddedAudioTracks.forEach((track, index) => {
        const embeddedTrackIndex = Number(track?.embeddedTrackIndex);
        const normalizedEmbeddedIndex = Number.isFinite(embeddedTrackIndex) && embeddedTrackIndex >= 0 ? embeddedTrackIndex : index;
        const nativeTrackIndex = Number(track?.nativeTrackIndex);
        const representedByNativeIndex =
          Number.isFinite(nativeTrackIndex) && nativeTrackIndex >= 0 && nativeTrackIndex < audioTracks.length;
        const representedByOrder = index < audioTracks.length;

        if (representedEmbeddedIndexes.has(normalizedEmbeddedIndex) || representedByNativeIndex || representedByOrder) {
          return;
        }

        const display = formatAudioTrackDisplay(track, index);
        const support = getAudioTrackSupportState(track);
        entries.push({
          id: `audio-embedded-${normalizedEmbeddedIndex}`,
          label: display.label,
          secondary: display.secondary,
          languageText: display.languageText,
          metadata: display.metadata,
          selected: normalizedEmbeddedIndex === this.selectedEmbeddedAudioTrackIndex,
          supported: support.supported,
          canTryAudioConversion: Boolean(support.canTryAudioConversion),
          unsupportedReason: support.unsupportedReason,
          embeddedAudioTrackIndex: normalizedEmbeddedIndex,
          track: {
            ...track,
            ...support
          }
        });
      });

      return entries;
    }
  };
}
