/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods62() {
  const { PlayerController, streamRepository, orderStreamsByAddonOrder, DebridStreamPresentation, isSelectKeyCode, t, clamp, escapeHtml } =
    internals;

  return {
    renderAudioControlItem(control, index) {
      const focused = this.audioFocusedColumn === "controls" && index === this.audioMixFocusIndex;
      if (control.toggle) {
        return `
            <div class="player-audio-control-card player-audio-toggle focusable${this.persistAudioAmplification ? " selected" : ""}${focused ? " focused" : ""}" role="switch" aria-checked="${this.persistAudioAmplification ? "true" : "false"}" data-audio-column="controls" data-audio-index="${index}">
              <div class="player-dialog-item-main">${escapeHtml(control.title)}</div>
              <div class="player-dialog-item-sub">${escapeHtml(control.helper || "")}</div>
            </div>
          `;
      }
      return `
          <div class="player-audio-control-card focusable${focused ? " focused" : ""}${!control.enabled ? " disabled" : ""}" data-audio-column="controls" data-audio-index="${index}">
            <div class="player-audio-control-title">${escapeHtml(control.title)}</div>
            <div class="player-audio-control-value">${escapeHtml(control.value)}</div>
            <div class="player-audio-step-row">
              <button class="player-dialog-step player-dialog-step-minus focusable${focused ? " focused" : ""}${!control.canDecrease ? " disabled" : ""}" type="button" tabindex="-1" data-audio-column="controls" data-audio-index="${index}" data-audio-step="-1" aria-label="${escapeHtml(t("cd_decrease", {}, "Decrease"))} ${escapeHtml(control.title)}">&#8722;</button>
              <button class="player-dialog-step player-dialog-step-plus focusable${focused ? " focused" : ""}${!control.canIncrease ? " disabled" : ""}" type="button" tabindex="-1" data-audio-column="controls" data-audio-index="${index}" data-audio-step="1" aria-label="${escapeHtml(t("cd_increase", {}, "Increase"))} ${escapeHtml(control.title)}">&#43;</button>
            </div>
            <div class="player-dialog-item-sub">${escapeHtml(control.helper || "")}</div>
          </div>
        `;
    },
    activateAudioControl(direction = 0) {
      if (this.audioMixFocusIndex === 0) {
        if (!this.audioAmplificationAvailable) {
          return;
        }
        this.adjustAudioAmplification(direction < 0 ? -1 : 1);
        return;
      }
      this.togglePersistAudioAmplification();
    },
    scrollAudioDialogIntoView() {
      const dialog = this.uiRefs?.audioDialog;
      if (!dialog || !this.audioDialogVisible) {
        return;
      }
      const target = dialog.querySelector(".player-audio-track-list .player-dialog-item.focused");
      target?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    },
    handleAudioDialogKey(event) {
      const keyCode = Number(event?.keyCode || 0);
      const entries = this.getAudioEntries();
      const isNavigationKey = keyCode === 37 || keyCode === 38 || keyCode === 39 || keyCode === 40 || isSelectKeyCode(keyCode);

      if (keyCode === 37) {
        if (this.audioFocusedColumn === "controls") {
          if (this.audioMixFocusIndex === 0) {
            this.activateAudioControl(-1);
          } else if (entries.length) {
            this.audioFocusedColumn = "tracks";
            this.renderAudioDialog();
          }
        }
        return true;
      }

      if (keyCode === 39) {
        if (this.audioFocusedColumn === "tracks") {
          if (!entries.length) {
            this.audioFocusedColumn = "controls";
            this.renderAudioDialog();
            return true;
          }
          this.audioFocusedColumn = "controls";
          this.renderAudioDialog();
        } else if (this.audioMixFocusIndex === 0) {
          this.activateAudioControl(1);
        }
        return true;
      }

      if (keyCode === 38) {
        if (this.audioFocusedColumn === "tracks") {
          this.audioDialogIndex = clamp(this.audioDialogIndex - 1, 0, entries.length - 1);
        } else {
          this.audioMixFocusIndex = clamp(this.audioMixFocusIndex - 1, 0, 1);
        }
        this.renderAudioDialog();
        return true;
      }

      if (keyCode === 40) {
        if (this.audioFocusedColumn === "tracks") {
          this.audioDialogIndex = clamp(this.audioDialogIndex + 1, 0, entries.length - 1);
        } else {
          this.audioMixFocusIndex = clamp(this.audioMixFocusIndex + 1, 0, 1);
        }
        this.renderAudioDialog();
        return true;
      }

      if (isSelectKeyCode(keyCode)) {
        if (this.audioFocusedColumn === "tracks") {
          this.applyAudioTrack(this.audioDialogIndex, { rememberSelection: true });
        } else {
          this.activateAudioControl(this.audioMixFocusIndex === 0 ? 1 : 0);
        }
        return true;
      }

      return isNavigationKey;
    },
    openSpeedDialog() {
      const currentSpeed = this.getPlaybackSpeed();
      const speedOptions = this.getPlaybackSpeedOptions();
      this.speedDialogVisible = true;
      this.subtitleDialogVisible = false;
      this.audioDialogVisible = false;
      this.sourcesPanelVisible = false;
      this.speedDialogIndex = Math.max(
        0,
        speedOptions.findIndex((value) => value === currentSpeed)
      );
      this.renderSubtitleDialog();
      this.renderAudioDialog();
      this.renderSourcesPanel();
      this.renderSpeedDialog();
      this.updateModalBackdrop();
    },
    closeSpeedDialog() {
      this.speedDialogVisible = false;
      this.renderSpeedDialog();
      this.updateModalBackdrop();
      this.resetControlsAutoHide();
    },
    async applyPlaybackSpeed(speed = 1) {
      if (this.partyBlocksControl?.()) {
        this.renderControlButtons();
        this.renderSpeedDialog();
        return false;
      }
      this.partyRateNudge = null;
      let applied = false;
      try {
        applied = typeof PlayerController.setPlaybackRate === "function" ? await PlayerController.setPlaybackRate(speed) : false;
      } catch (_) {
        applied = false;
      }
      if (!applied) {
        this.renderControlButtons();
        this.renderSpeedDialog();
        return false;
      }
      this.renderControlButtons();
      this.renderSpeedDialog();
      this.publishPartyPlayback?.({ rate: Number(speed) || 1 });
      return true;
    },
    renderSpeedDialog() {
      const dialog = this.uiRefs?.speedDialog;
      if (!dialog) {
        return;
      }
      dialog.classList.toggle("hidden", !this.speedDialogVisible);
      if (!this.speedDialogVisible) {
        dialog.innerHTML = "";
        return;
      }
      const currentSpeed = this.getPlaybackSpeed();
      const speedOptions = this.getPlaybackSpeedOptions();
      this.speedDialogIndex = clamp(this.speedDialogIndex, 0, speedOptions.length - 1);
      dialog.innerHTML = `
          <div class="player-dialog-title">${escapeHtml(t("player_playback_speed", {}, "Playback speed"))}</div>
          <div class="player-dialog-list">
            ${speedOptions
              .map(
                (speed, index) => `
              <div class="player-dialog-item focusable${speed === currentSpeed ? " selected" : ""}${index === this.speedDialogIndex ? " focused" : ""}" role="radio" aria-checked="${speed === currentSpeed ? "true" : "false"}" data-speed-index="${index}">
                <div class="player-dialog-item-main">${escapeHtml(`${speed}x`)}</div>
                <div class="player-dialog-item-sub">${escapeHtml(speed === 1 ? t("common.normal", {}, "Normal") : t("player_playback_speed", {}, "Playback speed"))}</div>
                <div class="player-dialog-item-check">${speed === currentSpeed ? "&#10003;" : ""}</div>
              </div>
            `
              )
              .join("")}
          </div>
        `;
    },
    handleSpeedDialogKey(event) {
      const keyCode = Number(event?.keyCode || 0);
      const speedOptions = this.getPlaybackSpeedOptions();
      if (keyCode === 38) {
        this.speedDialogIndex = clamp(this.speedDialogIndex - 1, 0, speedOptions.length - 1);
        this.renderSpeedDialog();
        return true;
      }
      if (keyCode === 40) {
        this.speedDialogIndex = clamp(this.speedDialogIndex + 1, 0, speedOptions.length - 1);
        this.renderSpeedDialog();
        return true;
      }
      if (isSelectKeyCode(keyCode)) {
        this.applyPlaybackSpeed(speedOptions[this.speedDialogIndex] || 1);
        return true;
      }
      return keyCode === 37 || keyCode === 38 || keyCode === 39 || keyCode === 40 || isSelectKeyCode(keyCode);
    },
    getSourceFilters(orderedStreams = this.getOrderedStreamCandidates()) {
      const addons = [];
      orderedStreams.forEach((stream) => {
        const addonName = String(stream?.addonName || "").trim();
        if (addonName && !addons.includes(addonName)) {
          addons.push(addonName);
        }
      });
      return ["all", ...addons];
    },
    getOrderedStreamCandidates() {
      return orderStreamsByAddonOrder(this.streamCandidates || [], [], {
        isDirectDebrid: (stream) => DebridStreamPresentation.isDirectDebrid(stream)
      });
    },
    getFilteredSources(orderedStreams = this.getOrderedStreamCandidates()) {
      if (this.sourceFilter === "all") {
        return orderedStreams;
      }
      return orderedStreams.filter((stream) => stream.addonName === this.sourceFilter);
    },
    ensureSourcesFocus(filters = null, list = null) {
      const availableFilters = Array.isArray(filters) ? filters : this.getSourceFilters();
      const availableSources = Array.isArray(list) ? list : this.getFilteredSources();

      if (!this.sourcesFocus || !["top", "filter", "list"].includes(this.sourcesFocus.zone)) {
        this.sourcesFocus = { zone: "filter", index: 0 };
      }

      if (this.sourcesFocus.zone === "top") {
        this.sourcesFocus.index = clamp(this.sourcesFocus.index, 0, 1);
        return;
      }

      if (this.sourcesFocus.zone === "filter") {
        this.sourcesFocus.index = clamp(this.sourcesFocus.index, 0, Math.max(0, availableFilters.length - 1));
        return;
      }

      this.sourcesFocus.index = clamp(this.sourcesFocus.index, 0, Math.max(0, availableSources.length - 1));
      if (!availableSources.length && availableFilters.length) {
        this.sourcesFocus = { zone: "filter", index: 0 };
      }
    },
    setSourceFilter(filter) {
      const available = this.getSourceFilters();
      if (!available.includes(filter)) {
        this.sourceFilter = "all";
        return;
      }
      this.sourceFilter = filter;
      this.sourcesFocus = {
        zone: "filter",
        index: clamp(available.indexOf(filter), 0, available.length - 1)
      };
    },
    cancelScheduledSourcesPanelRender() {
      if (this.sourcePanelRenderFrame == null) {
        return;
      }
      if (this.sourcePanelRenderFrameType === "raf") {
        if (typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(this.sourcePanelRenderFrame);
        } else {
          clearTimeout(this.sourcePanelRenderFrame);
        }
      } else {
        clearTimeout(this.sourcePanelRenderFrame);
      }
      this.sourcePanelRenderFrame = null;
      this.sourcePanelRenderFrameType = null;
    },
    scheduleSourcesPanelRender() {
      if (!this.sourcesPanelVisible || this.sourcePanelRenderFrame != null) {
        return;
      }
      const render = () => {
        this.sourcePanelRenderFrame = null;
        this.sourcePanelRenderFrameType = null;
        if (this.sourcesPanelVisible) {
          this.renderSourcesPanel();
        }
      };
      if (typeof requestAnimationFrame === "function") {
        this.sourcePanelRenderFrameType = "raf";
        this.sourcePanelRenderFrame = requestAnimationFrame(render);
        return;
      }
      this.sourcePanelRenderFrameType = "timeout";
      this.sourcePanelRenderFrame = setTimeout(render, 0);
    },
    openSourcesPanel({ forceReload = false } = {}) {
      streamRepository.setLocalPluginSearchPaused(false);
      this.cancelSeekPreview({ commit: false });
      this.sourcesPanelVisible = true;
      this.sourcesLastNavigationRepeatAt = 0;
      this.subtitleDialogVisible = false;
      this.audioDialogVisible = false;
      this.speedDialogVisible = false;
      this.moreActionsVisible = false;

      const filters = this.getSourceFilters();
      this.sourcesFocus = {
        zone: "filter",
        index: clamp(filters.indexOf(this.sourceFilter), 0, Math.max(0, filters.length - 1))
      };

      this.renderControlButtons();
      this.renderSubtitleDialog();
      this.renderAudioDialog();
      this.renderSpeedDialog();
      this.renderSourcesPanel();
      this.updateModalBackdrop();
      void this.preloadPlayerSourceLogos();

      const sourceRequestKey = this.getSourceRequestKey();
      // The candidates passed into the player are only a snapshot of the addons
      // that had replied before playback started. Refresh once per video so a
      // slower addon can still join the in-player list without a manual reload.
      if (forceReload || !sourceRequestKey || sourceRequestKey !== this.completedSourceRequestKey) {
        this.reloadSources({ forceRefresh: forceReload });
      }
    }
  };
}
