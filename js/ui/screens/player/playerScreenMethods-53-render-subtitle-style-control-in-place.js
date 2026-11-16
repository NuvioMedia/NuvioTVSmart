/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";
import {
  HDR_BRIGHTNESS_STEP,
  isEditingHdrSubtitleStyle,
  normalizeHdrBrightness,
  normalizeHdrTextColor
} from "../../../core/player/hdrSubtitleStyle.js";

export function createPlayerScreenMethods53() {
  const {
    SubtitleAppearance,
    PlayerController,
    PlayerSettingsStore,
    Environment,
    SUBTITLE_DELAY_MAX_MS,
    SUBTITLE_DELAY_MIN_MS,
    SUBTITLE_DELAY_STEP_MS,
    SUBTITLE_VERTICAL_OFFSET_DEFAULT,
    normalizeSubtitleVerticalOffset,
    SUBTITLE_TEXT_OPACITY_STEP,
    normalizeSubtitleTextOpacity,
    SUBTITLE_LANGUAGE_OFF_KEY,
    SUBTITLE_TEXT_COLORS,
    SUBTITLE_OUTLINE_COLORS,
    SUBTITLE_FONT_STEP,
    SUBTITLE_VERTICAL_OFFSET_STEP,
    getEmbeddedSubtitleSupportState,
    isTizenEmbeddedTextSubtitleFallbackTrack,
    canUseEmbeddedBitmapSubtitles,
    clamp,
    normalizeSubtitleFontSize
  } = internals;

  return {
    renderSubtitleStyleControlInPlace(controlId) {
      const dialog = this.uiRefs?.subtitleDialog;
      if (!dialog || !this.subtitleDialogVisible) return false;
      const styleControls = this.getSubtitleStyleControls();
      const items = controlId === "reset" ? styleControls : styleControls.filter((c) => c.id === controlId);
      items.forEach((item) => {
        const rowNode = dialog.querySelector(`button[data-style-id="${item.id}"]`)?.closest(".player-dialog-style-item");
        const mainNode = rowNode?.querySelector(".player-dialog-item-main");
        if (mainNode) mainNode.textContent = item.label || "";
        const subNode = rowNode?.querySelector(".player-dialog-item-sub");
        if (subNode) subNode.textContent = item.value || "";
      });
      return items.length > 0;
    },
    adjustSubtitleStyleControl(controlId, delta = 0, { isRepeat = false } = {}) {
      const activeControl = this.getSubtitleStyleControls().find((item) => item.id === controlId);
      if (!activeControl || activeControl.disabled) {
        return false;
      }
      const style = { ...(this.subtitleStyleSettings || {}) };
      if (controlId === "delay") {
        this.subtitleDelayMs = clamp(
          Number(this.subtitleDelayMs || 0) + delta * SUBTITLE_DELAY_STEP_MS,
          SUBTITLE_DELAY_MIN_MS,
          SUBTITLE_DELAY_MAX_MS
        );
      } else if (controlId === "resetDelay") {
        this.subtitleDelayMs = 0;
      } else if (controlId === "font" && delta !== 0) {
        // Android cycles the fonts both ways.
        const fonts = SubtitleAppearance.SUBTITLE_BUILT_IN_FONTS;
        const index = Math.max(0, fonts.indexOf(SubtitleAppearance.normalizeSubtitleFontId(style.fontId)));
        style.fontId = fonts[(index + delta + fonts.length) % fonts.length];
      } else if (controlId === "backgroundColor" && delta !== 0) {
        const presets = SubtitleAppearance.SUBTITLE_BACKGROUND_COLOR_PRESETS;
        const current = SubtitleAppearance.splitSubtitleBackground(style.backgroundColor);
        const index = current.opacity > 0 ? presets.indexOf(current.color) : -1;
        const nextIndex = index < 0 ? 0 : clamp(index + delta, 0, presets.length - 1);
        style.backgroundColor = SubtitleAppearance.subtitleBackgroundColorFor(presets[nextIndex], style.backgroundColor);
      } else if (controlId === "backgroundOpacity") {
        const current = SubtitleAppearance.splitSubtitleBackground(style.backgroundColor);
        style.backgroundColor = SubtitleAppearance.joinSubtitleBackground(current.color, clamp(current.opacity + delta * 10, 0, 100));
      } else if (controlId === "backgroundRadius") {
        style.backgroundRadius = clamp(
          SubtitleAppearance.normalizeSubtitleAppearance(style).backgroundRadius +
            delta * SubtitleAppearance.SUBTITLE_BACKGROUND_RADIUS_STEP,
          0,
          SubtitleAppearance.SUBTITLE_BACKGROUND_RADIUS_MAX
        );
      } else if (controlId === "shadowEnabled" && delta !== 0) {
        style.shadowEnabled = !SubtitleAppearance.normalizeSubtitleAppearance(style).shadowEnabled;
      } else if (controlId === "shadowOpacity") {
        style.shadowOpacity = clamp(SubtitleAppearance.normalizeSubtitleAppearance(style).shadowOpacity + delta * 10, 0, 100);
      } else if (controlId === "shadowSize") {
        style.shadowSize = clamp(
          SubtitleAppearance.normalizeSubtitleAppearance(style).shadowSize + delta,
          SubtitleAppearance.SUBTITLE_SHADOW_SIZE_MIN,
          SubtitleAppearance.SUBTITLE_SHADOW_SIZE_MAX
        );
      } else if (controlId === "fontSize") {
        style.fontSize = normalizeSubtitleFontSize(Number(style.fontSize || 120) + delta * SUBTITLE_FONT_STEP);
      } else if (controlId === "stripSdh" && delta !== 0) {
        style.stripSdh = !style.stripSdh;
      } else if (controlId === "bold" && delta !== 0) {
        style.bold = !style.bold;
      } else if (controlId === "textColor" && delta !== 0) {
        const isEditingHdrStyle = isEditingHdrSubtitleStyle(style, this.isCurrentPlaybackHdr?.() === true);
        const currentColor = isEditingHdrStyle
          ? normalizeHdrTextColor(style.hdrTextColor)
          : String(style.textColor || "#FFFFFF").toUpperCase();
        const currentIndex = Math.max(0, SUBTITLE_TEXT_COLORS.indexOf(currentColor));
        const nextColor = SUBTITLE_TEXT_COLORS[clamp(currentIndex + delta, 0, SUBTITLE_TEXT_COLORS.length - 1)];
        if (isEditingHdrStyle) {
          style.hdrTextColor = nextColor;
        } else {
          style.textColor = nextColor;
        }
      } else if (controlId === "textOpacity") {
        style.textOpacity = normalizeSubtitleTextOpacity(Number(style.textOpacity ?? 100) + delta * SUBTITLE_TEXT_OPACITY_STEP);
      } else if (controlId === "outlineEnabled" && delta !== 0) {
        style.outlineEnabled = !style.outlineEnabled;
      } else if (controlId === "outlineColor" && delta !== 0) {
        const currentIndex = Math.max(0, SUBTITLE_OUTLINE_COLORS.indexOf(String(style.outlineColor || "#000000").toUpperCase()));
        style.outlineColor = SUBTITLE_OUTLINE_COLORS[clamp(currentIndex + delta, 0, SUBTITLE_OUTLINE_COLORS.length - 1)];
      } else if (controlId === "outlineSize") {
        style.outlineSize = clamp(
          SubtitleAppearance.normalizeSubtitleAppearance(style).outlineSize + delta,
          SubtitleAppearance.SUBTITLE_OUTLINE_SIZE_MIN,
          SubtitleAppearance.SUBTITLE_OUTLINE_SIZE_MAX
        );
      } else if (controlId === "verticalOffset") {
        style.verticalOffset = normalizeSubtitleVerticalOffset(
          Number(style.verticalOffset ?? SUBTITLE_VERTICAL_OFFSET_DEFAULT) + delta * SUBTITLE_VERTICAL_OFFSET_STEP
        );
      } else if (controlId === "hdrBrightness") {
        style.hdrBrightness = normalizeHdrBrightness(Number(style.hdrBrightness ?? 40) + delta * HDR_BRIGHTNESS_STEP);
      } else if (controlId === "reset") {
        const defaults = PlayerSettingsStore.getDefaults().subtitleStyle;
        this.subtitleDelayMs = 0;
        this.subtitleStyleSettings = {
          ...style,
          fontSize: defaults.fontSize,
          textColor: defaults.textColor,
          textOpacity: defaults.textOpacity,
          bold: defaults.bold,
          stripSdh: defaults.stripSdh,
          outlineEnabled: defaults.outlineEnabled,
          outlineColor: defaults.outlineColor,
          verticalOffset: defaults.verticalOffset,
          verticalOffsetContract: defaults.verticalOffsetContract,
          hdrTextColor: defaults.hdrTextColor,
          hdrBrightness: defaults.hdrBrightness,
          backgroundColor: defaults.backgroundColor,
          ...SubtitleAppearance.SUBTITLE_APPEARANCE_DEFAULTS
        };
      }
      if ((controlId === "delay" || controlId === "resetDelay" || controlId === "reset") && this.isAssAddonSubtitleActive()) {
        // ass.js delay is seconds, positive = later; update in place instead
        // of recreating the renderer.
        this.assSubtitleRenderer?.setDelay(this.subtitleDelayMs);
      }

      if (controlId === "delay" || controlId === "resetDelay" || controlId === "reset") {
        this.persistSubtitleDelayPreference();
      }

      if (controlId !== "delay" && controlId !== "reset") {
        this.subtitleStyleSettings = style;
      }
      this.schedulePersistPlayerPresentationSettings();
      this.applySubtitlePresentationSettings({ refreshTrackRendering: !isRepeat });
      if (!this.renderSubtitleStyleControlInPlace(controlId)) {
        this.renderSubtitleDialog();
      }
      return true;
    },
    getSubtitleStyleControlDelta(side = this.subtitleStyleControlSide) {
      return String(side || "").toLowerCase() === "plus" ? 1 : -1;
    },
    openSubtitleDialog() {
      this.cancelSeekPreview({ commit: false });
      this.dismissSubtitleTimingDialog();
      this.hideSubtitleDelayOverlay({ scheduleControls: false });
      this.syncTrackState();
      this.subtitleDialogVisible = true;
      this.beginSubtitleDialogSession();
      this.audioDialogVisible = false;
      this.speedDialogVisible = false;
      this.sourcesPanelVisible = false;
      const languageRail = this.getSubtitleLanguageRailItems();
      const selectedLanguageKey = this.getSelectedSubtitleLanguageKey();
      this.subtitleLanguageRailIndex = Math.max(
        0,
        languageRail.findIndex((item) => item.key === selectedLanguageKey)
      );
      this.subtitleFocusedLanguageKey = languageRail[this.subtitleLanguageRailIndex]?.key || SUBTITLE_LANGUAGE_OFF_KEY;
      this.syncSubtitleOptionIndexForFocusedLanguage();
      this.subtitleStyleRailIndex = 0;
      this.subtitleStyleControlSide = "minus";
      this.subtitleFocusedRail = selectedLanguageKey === SUBTITLE_LANGUAGE_OFF_KEY ? "language" : "options";
      this.subtitleDialogScrollMode = "start";
      this.setControlsVisible(true, { focus: false });
      this.renderSubtitleDialog();
      this.renderAudioDialog();
      this.renderSpeedDialog();
      this.renderSourcesPanel();
      this.updateModalBackdrop();
    },
    closeSubtitleDialog() {
      this.flushPersistPlayerPresentationSettings();
      this.subtitleDialogVisible = false;
      this.subtitleFocusedRail = "language";
      this.subtitleFocusedLanguageKey = SUBTITLE_LANGUAGE_OFF_KEY;
      this.subtitleStyleControlSide = "minus";
      this.renderSubtitleDialog();
      this.subtitleDialogSession = null;
      this.subtitleOptionFocusMemory = new Map();
      this.resetSubtitleOptionVirtualState();
      this.updateModalBackdrop();
      this.resetControlsAutoHide();
    },
    cycleSubtitleTab(delta) {
      const tabs = this.getSubtitleTabs();
      const index = tabs.findIndex((tab) => tab.id === this.subtitleDialogTab);
      const nextIndex = clamp(index + delta, 0, tabs.length - 1);
      this.subtitleDialogTab = tabs[nextIndex].id;
      const entries = this.getSubtitleEntries(this.subtitleDialogTab);
      const selected = entries.findIndex((entry) => entry.selected);
      this.subtitleDialogIndex = Math.max(0, selected >= 0 ? selected : 0);
      this.renderSubtitleDialog();
    },
    getActiveSubtitleSelectionKey() {
      if (this.selectedAddonSubtitleId) {
        return `addon:${String(this.selectedAddonSubtitleId)}`;
      }
      if (this.selectedManifestSubtitleTrackId) {
        return `manifest:${String(this.selectedManifestSubtitleTrackId)}`;
      }
      if (Number(this.selectedEmbeddedSubtitleTrackIndex) >= 0) {
        return `embedded:${Number(this.selectedEmbeddedSubtitleTrackIndex)}`;
      }
      if (Number(this.selectedSubtitleTrackIndex) >= 0) {
        return `native:${Number(this.selectedSubtitleTrackIndex)}`;
      }
      return "off";
    },
    resetSubtitleDelayAfterSelectionChange(previousSelectionKey) {
      if (previousSelectionKey === this.getActiveSubtitleSelectionKey()) {
        return;
      }
      this.resetSubtitleAutoSyncState();
      if (Number(this.subtitleDelayMs || 0) === 0) {
        return;
      }
      this.subtitleDelayMs = 0;
      this.persistSubtitleDelayPreference();
      if (this.isAssAddonSubtitleActive()) {
        this.assSubtitleRenderer?.setDelay(0);
      }
      this.applySubtitlePresentationSettings({ refreshTrackRendering: true });
    },
    applyNativeEmbeddedSubtitleTrack(embeddedTrack, targetTrackIndex) {
      const previousSubtitleSelectionKey = this.getActiveSubtitleSelectionKey();
      this.clearEmbeddedSubtitleCueRefreshTimers();
      if (this.externalTrackNodes.length) {
        this.clearMountedExternalSubtitleTracks();
      }
      this.clearWebOsEmbeddedTextSubtitleOverlay({ dispose: true });
      this.clearHtmlSubtitleOverlay();
      this.clearBitmapSubtitleOverlay({ dispose: true });

      let applied = false;
      const useTizenEmbeddedTextHtmlFallback = isTizenEmbeddedTextSubtitleFallbackTrack(embeddedTrack);
      if (Environment.isTizen() && typeof PlayerController.isUsingAvPlay === "function" && PlayerController.isUsingAvPlay()) {
        const nativeTrackIndex = Number(embeddedTrack?.nativeTrackIndex);
        applied =
          typeof PlayerController.setAvPlaySubtitleTrack === "function" && Number.isFinite(nativeTrackIndex)
            ? PlayerController.setAvPlaySubtitleTrack(nativeTrackIndex, {
                renderMode: useTizenEmbeddedTextHtmlFallback ? "html" : this.subtitleRenderMode
              })
            : false;
      } else {
        const nativeTrackIndex = Number(embeddedTrack?.nativeTrackIndex);
        const selectionTrackIndex = Number.isFinite(nativeTrackIndex) && nativeTrackIndex >= 0 ? nativeTrackIndex : targetTrackIndex;
        applied =
          typeof PlayerController.setWebOsEmbeddedSubtitleTrack === "function"
            ? PlayerController.setWebOsEmbeddedSubtitleTrack(selectionTrackIndex, targetTrackIndex)
            : false;
      }
      if (!applied) {
        return false;
      }

      this.selectedEmbeddedSubtitleTrackIndex = Number.isFinite(targetTrackIndex) ? targetTrackIndex : -1;
      this.selectedSubtitleTrackIndex = -1;
      this.selectedAddonSubtitleId = null;
      this.selectedManifestSubtitleTrackId = null;
      this.resetSubtitleDelayAfterSelectionChange(previousSubtitleSelectionKey);
      this.invalidateTrackDialogCaches();
      this.scheduleEmbeddedSubtitleCueRefresh();
      if (this.refreshSubtitleCueStyles()) {
        this.refreshWebOsEmbeddedSubtitleAfterCueMutation();
      }
      if (embeddedTrack && !embeddedTrack.bitmapSubtitle && (Environment.isWebOS() || useTizenEmbeddedTextHtmlFallback)) {
        this.webOsEmbeddedTextSubtitleTrack = embeddedTrack;
        this.webOsEmbeddedTextSubtitleUsingHtml = false;
        void this.loadWebOsEmbeddedTextSubtitleWindow(this.getPlaybackCurrentSeconds());
      }
      this.renderControlButtons();
      this.renderSubtitleDialog();
      return true;
    },
    applyBitmapEmbeddedSubtitleTrack(embeddedTrack, targetTrackIndex, options = {}) {
      const isTizenBitmap = Environment.isTizen();
      // shortcut: Tizen software bitmap rendering is limited to VobSub because
      // AVPlay already draws PGS; widen it only if a firmware fails PGS too.
      if (
        !embeddedTrack?.bitmapSubtitle ||
        (isTizenBitmap && embeddedTrack?.bitmapSubtitleFormat !== "vobsub") ||
        getEmbeddedSubtitleSupportState(embeddedTrack).supported === false ||
        !canUseEmbeddedBitmapSubtitles()
      ) {
        return false;
      }
      const sourceTrackId = Number(embeddedTrack.sourceTrackId);
      if (!Number.isFinite(sourceTrackId) || sourceTrackId <= 0) {
        return false;
      }
      const avplayTrackIndex = Number(options.avplayTrackIndex);
      const previousSubtitleSelectionKey = this.getActiveSubtitleSelectionKey();
      if (isTizenBitmap) {
        if (
          !Number.isFinite(avplayTrackIndex) ||
          avplayTrackIndex < 0 ||
          typeof PlayerController.setAvPlaySubtitleTrack !== "function" ||
          !PlayerController.setAvPlaySubtitleTrack(avplayTrackIndex, { renderMode: "html", keepSilent: true })
        ) {
          return false;
        }
        // Keep AVPlay silent even when the selection is deferred until PLAYING.
        PlayerController.applyAvPlaySubtitleRenderMode?.("html");
      }
      this.clearEmbeddedSubtitleCueRefreshTimers();
      if (this.externalTrackNodes.length) {
        this.clearMountedExternalSubtitleTracks();
      }
      this.clearWebOsEmbeddedTextSubtitleOverlay({ dispose: true });
      this.clearHtmlSubtitleOverlay();
      this.clearBitmapSubtitleOverlay({ dispose: true });
      if (isTizenBitmap) {
        this.selectedSubtitleTrackIndex = avplayTrackIndex;
        this.selectedEmbeddedSubtitleTrackIndex = -1;
      } else {
        PlayerController.setWebOsEmbeddedSubtitleTrack?.(-1);
        this.selectedEmbeddedSubtitleTrackIndex = Number.isFinite(targetTrackIndex) ? targetTrackIndex : -1;
        this.selectedSubtitleTrackIndex = -1;
      }
      this.bitmapSubtitleTrack = embeddedTrack;
      this.selectedAddonSubtitleId = null;
      this.selectedManifestSubtitleTrackId = null;
      this.resetSubtitleDelayAfterSelectionChange(previousSubtitleSelectionKey);
      this.invalidateTrackDialogCaches();
      this.renderControlButtons();
      this.renderSubtitleDialog();
      void this.loadBitmapSubtitleWindow(this.getPlaybackCurrentSeconds());
      return true;
    }
  };
}
