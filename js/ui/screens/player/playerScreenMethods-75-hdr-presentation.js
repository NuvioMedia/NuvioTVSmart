/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";
import { playerControlsBrightness } from "../../../core/player/hdrSubtitleStyle.js";
import { readPlaybackHdrState } from "./playerPlaybackBadges.js";

const HDR_RECHECK_MS = 2500;
const HDR_RECHECK_WINDOW_MS = 20000;

export function createPlayerScreenMethods75() {
  const { PlayerController } = internals;

  return {
    /**
     * HDR/DV state for presentation. The decoder reports it after the first frames, so a
     * fresh stream is re-checked for a short window and then kept.
     */
    isCurrentPlaybackHdr() {
      const now = Date.now();
      const key = JSON.stringify([
        String(PlayerController.playbackEngine || ""),
        String(this.activePlaybackUrl || ""),
        Number(PlayerController.video?.videoWidth || 0),
        Number(PlayerController.video?.videoHeight || 0),
        Number(this.currentStreamIndex || 0),
        String(PlayerController.hlsInstance?.currentLevel ?? ""),
        String(PlayerController.avplayUrl || "")
      ]);
      if (this.hdrPlaybackKey !== key) {
        this.hdrPlaybackKey = key;
        this.hdrPlaybackFirstCheckedAt = now;
        this.hdrPlaybackCheckedAt = 0;
        this.currentPlaybackIsHdr = undefined;
      }
      if (this.currentPlaybackIsHdr === true) {
        return true;
      }
      const checkedAt = Number(this.hdrPlaybackCheckedAt || 0);
      if (checkedAt && (now - Number(this.hdrPlaybackFirstCheckedAt || now) > HDR_RECHECK_WINDOW_MS || now - checkedAt < HDR_RECHECK_MS)) {
        return this.currentPlaybackIsHdr === true;
      }
      this.hdrPlaybackCheckedAt = now;
      this.currentPlaybackIsHdr = readPlaybackHdrState(this, PlayerController);
      return this.currentPlaybackIsHdr;
    },

    /** Applies the HDR subtitle colors and the control/menu brightness, once per change. */
    syncHdrPresentation({ force = false } = {}) {
      const uiRoot = this.uiRefs?.root;
      if (!uiRoot || !PlayerController.video) {
        return;
      }
      const wasHdr = this.currentPlaybackIsHdr === true;
      const isHdr = this.isCurrentPlaybackHdr();
      const style = this.subtitleStyleSettings || {};
      const brightness = playerControlsBrightness(style, isHdr);
      const brightnessText = String(brightness);
      if (uiRoot.style.getPropertyValue("--player-controls-brightness") !== brightnessText) {
        uiRoot.style.setProperty("--player-controls-brightness", brightnessText);
      }
      uiRoot.classList.toggle("player-hdr-dim", brightness < 1);
      const signature = JSON.stringify([
        style.hdrStyleEnabled === true,
        style.hdrTextColor,
        style.hdrBrightness,
        style.hdrDimPlayerControls === true
      ]);
      if (wasHdr !== isHdr || this.hdrPresentationSignature !== signature || force) {
        this.hdrPresentationSignature = signature;
        this.applySubtitlePresentationSettings({ refreshTrackRendering: wasHdr !== isHdr });
      }
    }
  };
}
