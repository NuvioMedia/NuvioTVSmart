/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods58() {
  const {
    renderLoadingIndicator,
    calculateSubtitleAutoSyncDelayMs,
    formatSubtitleAutoSyncDelay,
    formatSubtitleAutoSyncTimestamp,
    sanitizeSubtitleAutoSyncCueText,
    isSelectKeyCode,
    SUBTITLE_LANGUAGE_OFF_KEY,
    t,
    clamp,
    escapeHtml,
    escapeAttribute
  } = internals;

  return {
    captureSubtitleAutoSyncTime() {
      const capturePositionMs = Math.max(0, Math.trunc(Number(this.getPlaybackCurrentSeconds() || 0) * 1000));
      this.subtitleAutoSyncCapturedVideoMs = capturePositionMs;
      this.subtitleTimingStage = "pick";
      this.subtitleAutoSyncStatus = "";
      this.subtitleAutoSyncError = "";
      const visibleCues = this.getSubtitleAutoSyncVisibleCues(capturePositionMs);
      this.subtitleAutoSyncCueFocusIndex = Math.max(
        0,
        visibleCues.reduce(
          (nearestIndex, cue, index, list) =>
            Math.abs(cue.startTimeMs - capturePositionMs) < Math.abs((list[nearestIndex]?.startTimeMs || 0) - capturePositionMs)
              ? index
              : nearestIndex,
          0
        )
      );
      this.renderSubtitleTimingDialog();
      setTimeout(() => this.syncSubtitleTimingFocusDom({ focus: true }), 50);
    },
    applySubtitleAutoSyncCue(cue = null) {
      const cueStartTimeMs = Number(cue?.startTimeMs);
      const capturePositionMs = Number(this.subtitleAutoSyncCapturedVideoMs ?? this.getPlaybackCurrentSeconds() * 1000);
      if (!Number.isFinite(cueStartTimeMs) || !Number.isFinite(capturePositionMs)) {
        return;
      }
      const newDelayMs = calculateSubtitleAutoSyncDelayMs(capturePositionMs, cueStartTimeMs);
      this.subtitleDelayMs = newDelayMs;
      if (this.isAssAddonSubtitleActive()) {
        this.assSubtitleRenderer?.setDelay(newDelayMs);
      }
      this.persistSubtitleDelayPreference();
      this.applySubtitlePresentationSettings({ refreshTrackRendering: true });
      this.subtitleAutoSyncLoadToken = Number(this.subtitleAutoSyncLoadToken || 0) + 1;
      this.subtitleAutoSyncStatus = t(
        "subtitle_auto_sync_applied",
        [formatSubtitleAutoSyncDelay(newDelayMs)],
        `Sync applied: ${formatSubtitleAutoSyncDelay(newDelayMs)}`
      );
      this.subtitleTimingDialogVisible = false;
      this.subtitleTimingStage = "wait";
      this.subtitleDelayOverlayVisible = true;
      this.subtitleDelayFocusTarget = "slider";
      this.subtitleDialogVisible = false;
      this.renderSubtitleTimingDialog();
      this.renderSubtitleDelayOverlay();
      this.updateModalBackdrop();
      this.scheduleHideSubtitleDelayOverlay();
    },
    syncSubtitleTimingFocusDom({ focus = false, scroll = true } = {}) {
      const dialog = this.uiRefs?.subtitleTimingDialog;
      if (!dialog || !this.subtitleTimingDialogVisible) {
        return false;
      }
      const target =
        this.subtitleTimingStage === "wait"
          ? dialog.querySelector("[data-subtitle-timing-action='capture']")
          : dialog.querySelector(`[data-subtitle-timing-cue-index="${Number(this.subtitleAutoSyncCueFocusIndex || 0)}"]`);
      if (!target) {
        return false;
      }
      dialog.querySelectorAll(".focused").forEach((node) => node.classList.remove("focused"));
      target.classList.add("focused");
      if (scroll) {
        try {
          target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        } catch (_) {
          target.scrollIntoView?.();
        }
      }
      if (focus && document.activeElement !== target) {
        target.focus?.();
      }
      return true;
    },
    handleSubtitleTimingDialogKey(event) {
      const keyCode = Number(event?.keyCode || 0);
      if (this.subtitleTimingStage === "wait") {
        if (isSelectKeyCode(keyCode)) {
          this.captureSubtitleAutoSyncTime();
        }
        return true;
      }

      const visibleCues = this.getSubtitleAutoSyncVisibleCues(
        this.subtitleAutoSyncCapturedVideoMs ?? this.getPlaybackCurrentSeconds() * 1000
      );
      if (keyCode === 38 || keyCode === 40) {
        const delta = keyCode === 40 ? 1 : -1;
        this.subtitleAutoSyncCueFocusIndex = clamp(
          Number(this.subtitleAutoSyncCueFocusIndex || 0) + delta,
          0,
          Math.max(0, visibleCues.length - 1)
        );
        this.syncSubtitleTimingFocusDom({ focus: true });
        return true;
      }
      if (isSelectKeyCode(keyCode)) {
        const cue = visibleCues[this.subtitleAutoSyncCueFocusIndex];
        if (cue) {
          this.applySubtitleAutoSyncCue(cue);
        }
        return true;
      }
      return true;
    },
    handleSubtitleTimingDialogPointer(target) {
      if (!this.subtitleTimingDialogVisible) {
        return false;
      }
      const capture = target?.closest?.("[data-subtitle-timing-action='capture']");
      if (capture) {
        this.captureSubtitleAutoSyncTime();
        return true;
      }
      const cueNode = target?.closest?.("[data-subtitle-timing-cue-index]");
      if (!cueNode) {
        return false;
      }
      const visibleCues = this.getSubtitleAutoSyncVisibleCues(
        this.subtitleAutoSyncCapturedVideoMs ?? this.getPlaybackCurrentSeconds() * 1000
      );
      const index = Number(cueNode.dataset.subtitleTimingCueIndex);
      const cue = visibleCues[index];
      if (cue) {
        this.subtitleAutoSyncCueFocusIndex = index;
        this.applySubtitleAutoSyncCue(cue);
      }
      return true;
    },
    renderSubtitleTimingDialog() {
      const dialog = this.uiRefs?.subtitleTimingDialog;
      if (!dialog) {
        return;
      }
      const visible = Boolean(this.subtitleTimingDialogVisible);
      dialog.classList.toggle("hidden", !visible);
      dialog.classList.toggle("pick-line", visible && this.subtitleTimingStage === "pick");
      dialog.setAttribute("aria-hidden", visible ? "false" : "true");
      if (!visible) {
        dialog.innerHTML = "";
        return;
      }

      const selectedAddonSubtitle = this.getSelectedAddonSubtitle();
      if (this.subtitleTimingStage === "wait") {
        dialog.innerHTML = `
            <div class="player-subtitle-timing-panel player-subtitle-timing-panel-wait">
              <div class="player-subtitle-timing-prompt">${escapeHtml(t("subtitle_timing_press_sync", {}, "Press Sync when you hear a dialog line."))}</div>
              <button class="player-subtitle-timing-sync-button focusable" type="button" tabindex="-1" data-subtitle-timing-action="capture">${escapeHtml(t("subtitle_timing_sync_button", {}, "Sync"))}</button>
            </div>
          `;
        this.syncSubtitleTimingFocusDom({ focus: false });
        return;
      }

      const capturedLabel =
        this.subtitleAutoSyncCapturedVideoMs == null
          ? t("subtitle_timing_capturing", {}, "Capturing…")
          : t("subtitle_timing_captured_at", [formatSubtitleAutoSyncTimestamp(this.subtitleAutoSyncCapturedVideoMs)], "Captured at %1$s");
      const visibleCues = this.getSubtitleAutoSyncVisibleCues(
        this.subtitleAutoSyncCapturedVideoMs ?? this.getPlaybackCurrentSeconds() * 1000
      );
      this.subtitleAutoSyncCueFocusIndex = clamp(Number(this.subtitleAutoSyncCueFocusIndex || 0), 0, Math.max(0, visibleCues.length - 1));
      const selectedLanguage = this.getSubtitleAutoSyncLanguageLabel(selectedAddonSubtitle);
      const statusMarkup = this.subtitleAutoSyncStatus
        ? `<div class="player-subtitle-timing-status">${escapeHtml(this.subtitleAutoSyncStatus)}</div>`
        : "";
      const errorMarkup = this.subtitleAutoSyncError
        ? `<div class="player-subtitle-timing-error">${escapeHtml(this.subtitleAutoSyncError)}</div>`
        : "";
      let bodyMarkup = "";
      if (errorMarkup) {
        bodyMarkup = errorMarkup;
      } else if (!selectedAddonSubtitle) {
        bodyMarkup = `<div class="player-subtitle-timing-error">${escapeHtml(t("subtitle_timing_select_addon_first", {}, "Select an addon subtitle track first."))}</div>`;
      } else if (this.subtitleAutoSyncLoading) {
        bodyMarkup = `
            <div class="player-subtitle-timing-loading">
              ${renderLoadingIndicator({ className: "player-subtitle-timing-loading-indicator" })}
              <div>${escapeHtml(t("subtitle_timing_loading", {}, "Loading subtitle lines…"))}</div>
            </div>
          `;
      } else if (!visibleCues.length) {
        bodyMarkup = `<div class="player-subtitle-timing-empty">${escapeHtml(t("subtitle_timing_no_lines_found", {}, "No subtitle lines were found around this moment."))}</div>`;
      } else {
        bodyMarkup = `
            <div class="player-subtitle-timing-cue-list">
              ${visibleCues
                .map(
                  (cue, index) => `
                    <div class="player-subtitle-timing-cue-row focusable${index === this.subtitleAutoSyncCueFocusIndex ? " focused" : ""}" tabindex="-1" data-subtitle-timing-cue-index="${index}">
                      <span class="player-subtitle-timing-cue-time" dir="ltr">${escapeHtml(formatSubtitleAutoSyncTimestamp(cue.startTimeMs))}</span>
                      <span class="player-subtitle-timing-cue-text" dir="ltr">${escapeHtml(sanitizeSubtitleAutoSyncCueText(cue.text))}</span>
                    </div>
                  `
                )
                .join("")}
            </div>
            <div class="player-subtitle-timing-footer">${escapeHtml(t("subtitle_timing_press_back_cancel", {}, "Press Back to cancel"))}</div>
          `;
      }
      dialog.innerHTML = `
          <div class="player-subtitle-timing-panel player-subtitle-timing-panel-pick">
            <div class="player-subtitle-timing-header">
              <div class="player-subtitle-timing-captured">${escapeHtml(capturedLabel)}</div>
              ${selectedLanguage ? `<div class="player-subtitle-timing-language">${escapeHtml(selectedLanguage)}</div>` : ""}
            </div>
            ${statusMarkup}
            ${bodyMarkup}
          </div>
        `;
      this.syncSubtitleTimingFocusDom({ focus: false, scroll: false });
    },
    renderSubtitleStyleItemMarkup(item, index) {
      if (item.id === "delay") {
        const interactive = !item.disabled;
        return `
            <div class="player-dialog-item player-dialog-style-item player-subtitle-delay-entry${item.disabled ? " disabled" : ""}${interactive ? " focusable" : ""}" data-subtitle-rail="style" data-subtitle-index="${index}" data-subtitle-key="${escapeAttribute(item.id)}" data-subtitle-delay-action="open" aria-disabled="${item.disabled ? "true" : "false"}"${interactive ? ' tabindex="-1"' : ""}>
              <div class="player-dialog-item-main">${escapeHtml(item.label)}</div>
              <div class="player-dialog-item-sub player-subtitle-delay-entry-value" dir="ltr">${escapeHtml(item.value || "")}</div>
            </div>
          `;
      }
      return `
          <div class="player-dialog-item player-dialog-style-item${item.disabled ? " disabled" : ""}" data-subtitle-rail="style" data-subtitle-index="${index}" data-subtitle-key="${escapeAttribute(item.id)}" aria-disabled="${item.disabled ? "true" : "false"}">
            <button class="player-dialog-step player-dialog-step-minus${item.disabled ? "" : " focusable"}" type="button" data-subtitle-style-action="decrease" data-subtitle-rail="style" data-subtitle-index="${index}" data-style-id="${escapeAttribute(item.id)}" aria-label="${escapeAttribute(`${item.label} -`)}"${item.disabled ? " disabled" : ""}>&#8722;</button>
            <div class="player-dialog-item-center">
              <div class="player-dialog-item-main">${escapeHtml(item.label)}</div>
              <div class="player-dialog-item-sub">${escapeHtml(item.value || "")}</div>
            </div>
            <button class="player-dialog-step player-dialog-step-plus${item.disabled ? "" : " focusable"}" type="button" data-subtitle-style-action="increase" data-subtitle-rail="style" data-subtitle-index="${index}" data-style-id="${escapeAttribute(item.id)}" aria-label="${escapeAttribute(`${item.label} +`)}"${item.disabled ? " disabled" : ""}>&#43;</button>
          </div>
        `;
    },
    renderSubtitleDialog() {
      const dialog = this.uiRefs?.subtitleDialog;
      if (!dialog) {
        return;
      }

      dialog.classList.toggle("hidden", !this.subtitleDialogVisible);
      if (!this.subtitleDialogVisible) {
        dialog.innerHTML = "";
        this.renderedSubtitleDialogMarkup = "";
        return;
      }

      const languages = this.getSubtitleLanguageRailItems();
      this.subtitleLanguageRailIndex = clamp(this.subtitleLanguageRailIndex, 0, Math.max(0, languages.length - 1));
      this.subtitleFocusedLanguageKey = languages[this.subtitleLanguageRailIndex]?.key || SUBTITLE_LANGUAGE_OFF_KEY;
      const selectedLanguageKey = this.getSelectedSubtitleLanguageKey();
      const options = this.getSubtitleOptionsForLanguage(selectedLanguageKey);
      this.subtitleOptionRailIndex = clamp(this.subtitleOptionRailIndex, 0, Math.max(0, options.length - 1));
      const styleItems = this.getSubtitleStyleControls();
      this.subtitleStyleRailIndex = clamp(this.subtitleStyleRailIndex, 0, Math.max(0, styleItems.length - 1));
      const subtitleLoadingVisible = Boolean(
        this.subtitleLoading ||
        this.manifestLoading ||
        this.trackDiscoveryInProgress ||
        (this.embeddedSubtitleLoading && this.canDiscoverEmbeddedSubtitleTracks())
      );
      const showOptionsRail = selectedLanguageKey !== SUBTITLE_LANGUAGE_OFF_KEY || subtitleLoadingVisible;
      const supportNotice = this.getSubtitleDialogSupportNotice();
      const optionsMarkup = this.renderSubtitleOptionsMarkup(options, {
        subtitleLoadingVisible,
        languageKey: selectedLanguageKey
      });

      const nextMarkup = `
          <div class="player-dialog-title">${escapeHtml(t("subtitle_dialog_title", {}, "Subtitles"))}</div>
          ${supportNotice ? `<div class="player-dialog-support-message" role="status">${escapeHtml(supportNotice)}</div>` : ""}
          <div class="player-subtitle-overlay-grid">
            <div class="player-subtitle-rail player-subtitle-language-rail">
              ${languages
                .map(
                  (item, index) => `
              <div class="player-dialog-item focusable${item.selected ? " selected" : ""}" role="radio" aria-checked="${item.selected ? "true" : "false"}" data-subtitle-rail="language" data-subtitle-index="${index}" data-subtitle-key="${escapeAttribute(item.key)}">
                  <div class="player-dialog-item-main">${escapeHtml(item.label)}${item.count > 0 ? `<span class="player-subtitle-language-count">${item.count}</span>` : ""}</div>
                  <div class="player-dialog-item-sub">${item.key === SUBTITLE_LANGUAGE_OFF_KEY && subtitleLoadingVisible ? escapeHtml(t("subtitle_loading_builtin", {}, "Loading subtitle tracks...")) : ""}</div>
                </div>
              `
                )
                .join("")}
            </div>
            <div class="player-subtitle-rail player-subtitle-options-rail${showOptionsRail ? "" : " hidden"}">
              ${optionsMarkup}
            </div>
            <div class="player-subtitle-rail player-subtitle-style-rail${showOptionsRail ? "" : " hidden"}">
              ${styleItems.map((item, index) => this.renderSubtitleStyleItemMarkup(item, index)).join("")}
            </div>
          </div>
        `;
      const mounted = Boolean(dialog.querySelector(".player-subtitle-overlay-grid"));
      if (!mounted || this.renderedSubtitleDialogMarkup !== nextMarkup) {
        dialog.innerHTML = nextMarkup;
        this.renderedSubtitleDialogMarkup = nextMarkup;
      }
      this.applySubtitleOptionVirtualScrollPosition();
      this.syncSubtitleDialogFocusDom({ scroll: false });
      this.scrollSubtitleDialogIntoView();
      this.scheduleSubtitleDialogScrollIntoView();
      this.scheduleSubtitleOptionVirtualMeasurement();
    }
  };
}
