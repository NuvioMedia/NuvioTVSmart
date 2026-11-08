/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";
import { focusWithoutScroll } from "../../navigation/focusWithoutScroll.js";
import { segmentCategory } from "../../../core/player/skipIntervalRules.js";

export function createPlayerScreenMethods08() {
  const { PlayerSettingsStore, findActiveSkipIntervalRule, SKIP_INTRO_COUNTDOWN_MS, clamp, isPlayerDomNodeAttached, getSkipIntervalKey } =
    internals;

  return {
    updateActiveSkipInterval(currentTime = this.getPlaybackCurrentSeconds()) {
      if (!PlayerSettingsStore.get().skipIntroEnabled) {
        if (this.activeSkipInterval != null) {
          this.activeSkipInterval = null;
          this.renderSkipIntroButton();
        }
        return;
      }
      const previous = this.activeSkipInterval;
      let active = findActiveSkipIntervalRule(this.skipIntervals, currentTime);
      const candidateKey = getSkipIntervalKey(active);
      const suppressedKey = String(this.skipIntroSuppressedKey || "");
      const suppressionActive = suppressedKey && Date.now() < Number(this.skipIntroSuppressedUntil || 0);
      if (suppressedKey && !suppressionActive) {
        this.skipIntroSuppressedKey = "";
        this.skipIntroSuppressedUntil = 0;
      } else if (suppressionActive && candidateKey === suppressedKey) {
        // TV playback engines can briefly report the pre-seek position while a
        // skip seek settles. Keep the skipped interval hidden through that churn.
        active = null;
      }
      if (!active && previous && !suppressionActive) {
        // A provider swap can shift the same segment by a second (API recap ->
        // chapter recap). Keep its button alive without resetting the timer.
        const positionSec = Number(currentTime);
        const previousIntervalCategory = segmentCategory(previous.type);
        if (previousIntervalCategory && Number.isFinite(positionSec)) {
          const replacement = this.skipIntervals.find((interval) => {
            const start = Number(interval?.startTime);
            return (
              segmentCategory(interval?.type) === previousIntervalCategory &&
              Number.isFinite(start) &&
              positionSec < start &&
              start - positionSec <= 2
            );
          });
          if (replacement) {
            active = replacement;
          }
        }
      }
      const previousKey = getSkipIntervalKey(previous);
      const nextKey = getSkipIntervalKey(active);
      const previousCategory = segmentCategory(previous?.type);
      const nextCategory = segmentCategory(active?.type);
      if (previousCategory !== nextCategory) {
        this.skipIntervalDismissed = false;
        this.skipIntroAutoHidden = false;
        this.skipIntroCountdownProgress = 0;
        this.skipIntroCountdownLastTickAt = Date.now();
        this.skipIntroCountdownStartAt = 0;
        this.stopSkipIntroCountdownAnimation();
      }
      this.activeSkipInterval = active;
      if (previousKey !== nextKey) {
        const intervalType = String(active?.type || "")
          .trim()
          .toLowerCase();
        const autoSkipType = ["outro", "ed", "mixed-ed"].includes(intervalType)
          ? "outro"
          : intervalType === "recap"
            ? "recap"
            : intervalType === "movie-credits"
              ? "movie-credits"
              : "intro";
        if (active && PlayerSettingsStore.get().autoSkipSegmentTypes?.includes(autoSkipType) && !this.isPartyControlLocked?.()) {
          this.skipActiveInterval();
          return;
        }
        this.renderSkipIntroButton();
        this.updateSkipIntroCountdown(Date.now());
      }
    },
    getSkipIntervalProgress(interval = this.activeSkipInterval, currentTime = this.getPlaybackCurrentSeconds()) {
      if (!interval) {
        return 0;
      }
      const start = Number(interval.startTime);
      const end = Number(interval.endTime);
      const current = Number(currentTime);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !Number.isFinite(current)) {
        return 0;
      }
      return clamp((current - start) / (end - start), 0, 1);
    },
    isSkipIntroPlaybackReady() {
      return Boolean(this.hasPresentedPlaybackFrame && !this.loadingVisible);
    },
    stopSkipIntroCountdownAnimation() {
      if (this.skipIntroAnimationFrame != null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(this.skipIntroAnimationFrame);
      }
      this.skipIntroAnimationFrame = null;
      this.skipIntroCountdownStartAt = 0;
    },
    updateSkipIntroCountdown(now = Date.now()) {
      const playbackReady = this.isSkipIntroPlaybackReady();
      const shouldTrack = Boolean(this.activeSkipInterval) && playbackReady && !this.skipIntervalDismissed;
      if (!shouldTrack) {
        this.stopSkipIntroCountdownAnimation();
        this.skipIntroAutoHidden = false;
        this.skipIntroCountdownProgress = 0;
        this.skipIntroCountdownLastTickAt = Number(now || Date.now());
        return;
      }

      if (!this.controlsVisible) {
        this.startSkipIntroCountdownAnimation();
        return;
      }

      this.stopSkipIntroCountdownAnimation();
      this.skipIntroCountdownLastTickAt = Number(now || Date.now());
    },
    startSkipIntroCountdownAnimation() {
      if (typeof requestAnimationFrame !== "function") {
        this.skipIntroCountdownProgress = clamp(this.skipIntroCountdownProgress, 0, 1);
        if (this.skipIntroCountdownProgress >= 1) {
          this.skipIntroAutoHidden = true;
        }
        this.syncSkipIntroButtonProgress();
        return;
      }

      if (
        !this.activeSkipInterval ||
        !this.isSkipIntroPlaybackReady() ||
        this.skipIntervalDismissed ||
        this.controlsVisible ||
        this.skipIntroAutoHidden
      ) {
        return;
      }

      if (this.skipIntroAnimationFrame != null) {
        return;
      }

      const currentProgress = clamp(this.skipIntroCountdownProgress, 0, 1);
      this.skipIntroCountdownStartAt = 0;

      const tick = (timestamp) => {
        this.skipIntroAnimationFrame = null;
        if (!this.activeSkipInterval || !this.isSkipIntroPlaybackReady() || this.skipIntervalDismissed || this.controlsVisible) {
          this.syncSkipIntroButtonProgress();
          return;
        }

        const now = Number(timestamp || Date.now());
        if (!this.skipIntroCountdownStartAt) {
          this.skipIntroCountdownStartAt = now - currentProgress * SKIP_INTRO_COUNTDOWN_MS;
        }
        const elapsed = Math.max(0, now - Number(this.skipIntroCountdownStartAt || 0));
        this.skipIntroCountdownProgress = clamp(elapsed / SKIP_INTRO_COUNTDOWN_MS, 0, 1);
        this.syncSkipIntroButtonProgress();

        if (this.skipIntroCountdownProgress >= 1) {
          this.skipIntroAutoHidden = true;
          this.renderSkipIntroButton();
          return;
        }

        this.skipIntroAnimationFrame = requestAnimationFrame(tick);
      };

      this.skipIntroAnimationFrame = requestAnimationFrame(tick);
    },
    syncSkipIntroButtonProgress() {
      const button = this.uiRefs?.skipIntro?.querySelector(".player-skip-intro-btn");
      if (!button) {
        return;
      }
      const fill = button.querySelector(".player-skip-intro-progress-fill");
      const progressNode = button.querySelector(".player-skip-intro-progress");
      if (fill) {
        fill.style.transform = `scaleX(${clamp(this.skipIntroCountdownProgress, 0, 1)})`;
      }
      if (progressNode) {
        const progressVisible = !this.controlsVisible && !this.skipIntroAutoHidden && !this.skipIntervalDismissed;
        progressNode.style.opacity = progressVisible ? "1" : "0";
      }
    },
    syncSkipIntroButtonTheme(button = null) {
      const target = button || this.uiRefs?.skipIntro?.querySelector(".player-skip-intro-btn");
      if (!target) {
        return;
      }

      const rootStyle = getComputedStyle(document.documentElement);
      const focusBackground = rootStyle.getPropertyValue("--player-focus-background").trim() || "#303030";
      const focusContent = rootStyle.getPropertyValue("--player-text-primary").trim() || "#ffffff";
      const focusRing = rootStyle.getPropertyValue("--player-focus-ring").trim() || "#ffffff";
      const isFocused = document.activeElement === target || target.classList.contains("focused");
      const background = isFocused ? focusBackground : "rgba(30, 30, 30, 0.85)";
      const color = isFocused ? focusContent : "#fff";
      const boxShadow = isFocused ? `0 0 0 4px ${focusRing}` : "none";

      target.style.setProperty("background", background, "important");
      target.style.setProperty("background-color", background, "important");
      target.style.setProperty("color", color, "important");
      target.style.setProperty("box-shadow", boxShadow, "important");

      const icon = target.querySelector(".player-skip-intro-icon");
      const label = target.querySelector(".player-skip-intro-label");
      icon?.style.setProperty("color", color, "important");
      label?.style.setProperty("color", color, "important");
      label?.style.setProperty("-webkit-text-fill-color", color, "important");
    },
    isSkipIntroButtonVisible() {
      const container = this.uiRefs?.skipIntro;
      const button = container?.querySelector(".player-skip-intro-btn");
      return Boolean(button && isPlayerDomNodeAttached(button) && !container.classList.contains("hidden"));
    },
    isSkipIntroButtonFocusable() {
      return this.isSkipIntroButtonVisible();
    },
    isNextEpisodeCardFocusable() {
      const card = this.uiRefs?.nextEpisodeCard;
      const target = card?.querySelector(".player-next-episode-card-inner");
      return Boolean(target && isPlayerDomNodeAttached(target) && !card.classList.contains("hidden"));
    },
    syncSkipIntroFocusState() {
      const button = this.uiRefs?.skipIntro?.querySelector(".player-skip-intro-btn");
      if (!button) {
        return;
      }
      const focused = this.controlFocusZone === "skipIntro" && this.isSkipIntroButtonFocusable();
      button.classList.toggle("focused", focused);
      if (focused) {
        const activeElement = document.activeElement;
        if (activeElement && activeElement !== button && activeElement !== document.body && typeof activeElement.blur === "function") {
          activeElement.blur();
        }
        if (document.activeElement !== button && typeof button.focus === "function") {
          try {
            button.focus();
          } catch (_) {
            // Some TV runtimes can reject focus during DOM churn.
          }
        }
      }
      this.syncSkipIntroButtonTheme(button);
    },
    syncNextEpisodeCardFocusState() {
      const card = this.uiRefs?.nextEpisodeCard;
      const target = card?.querySelector(".player-next-episode-card-inner");
      if (!target) {
        return;
      }
      const focused = this.controlFocusZone === "nextEpisode" && !card.classList.contains("hidden") && this.isNextEpisodeCardFocusable();
      target.classList.toggle("is-selected", focused && !this.controlsVisible);
      target.classList.toggle("focused", focused);
      if (!focused) {
        if (document.activeElement === target) {
          target.blur?.();
        }
        return;
      }
      const activeElement = document.activeElement;
      if (activeElement && activeElement !== target && activeElement !== document.body && typeof activeElement.blur === "function") {
        activeElement.blur();
      }
      if (document.activeElement !== target && typeof target.focus === "function") {
        focusWithoutScroll(target);
      }
    },
    focusSkipIntroButton() {
      if (!this.isSkipIntroButtonFocusable()) {
        return false;
      }
      this.stickyProgressFocus = false;
      this.autoHideControlsAfterSeek = false;
      this.controlFocusZone = "skipIntro";
      this.syncControlFocusDom();
      this.syncSkipIntroFocusState();
      this.resetControlsAutoHide();
      return true;
    },
    focusNextEpisodeCard() {
      if (!this.isNextEpisodeCardFocusable()) {
        return false;
      }
      if (this.skipIntroFocusFrame != null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(this.skipIntroFocusFrame);
        this.skipIntroFocusFrame = null;
      }
      this.stickyProgressFocus = false;
      this.autoHideControlsAfterSeek = false;
      this.controlFocusZone = "nextEpisode";
      this.syncControlFocusDom();
      this.syncNextEpisodeCardFocusState();
      this.resetControlsAutoHide();
      return true;
    }
  };
}
