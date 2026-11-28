/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";
import { playerControlsBrightness } from "../../../core/player/hdrSubtitleStyle.js";
import { readPlaybackHdrStatus } from "./playerPlaybackBadges.js";

const HDR_RECHECK_MS = 250;
const HDR_RECHECK_WINDOW_MS = 20000;

export function createPlayerScreenMethods75() {
  const { PlayerController } = internals;

  return {
    /**
     * HDR/DV state for presentation. The decoder reports it after the first frames, so a
     * fresh stream is re-checked on a tight startup cadence and preserved across transient
     * reloads unless the source changes or SDR is explicitly confirmed.
     */
    isCurrentPlaybackHdr({ recheck = false } = {}) {
      const now = Date.now();
      const activeUrl = String(this.activePlaybackUrl || "");
      const isManifestVariant =
        Boolean(activeUrl) &&
        Boolean(this.hdrPlaybackSourceUrl) &&
        (activeUrl === this.manifestMasterUrl ||
          (Array.isArray(this.manifestVariants) && this.manifestVariants.some((variant) => variant?.uri === activeUrl)));
      const logicalUrl = isManifestVariant ? this.hdrPlaybackSourceUrl : activeUrl;
      const sourceKey = JSON.stringify([Number(this.playerMountToken || 0), logicalUrl, Number(this.currentStreamIndex || 0)]);
      if (this.hdrPlaybackSourceKey !== sourceKey) {
        this.hdrPlaybackSourceKey = sourceKey;
        this.hdrPlaybackSourceUrl = logicalUrl;
        this.hdrPlaybackKey = "";
        this.hdrPlaybackFirstCheckedAt = 0;
        this.hdrPlaybackCheckedAt = 0;
        this.currentPlaybackIsHdr = undefined;
      }

      const playbackKey = JSON.stringify([
        String(PlayerController.playbackEngine || ""),
        activeUrl,
        Number(PlayerController.video?.videoWidth || 0),
        Number(PlayerController.video?.videoHeight || 0),
        Number(this.currentStreamIndex || 0),
        String(PlayerController.hlsInstance?.currentLevel ?? ""),
        String(PlayerController.avplayUrl || ""),
        Boolean(PlayerController.avplayReady)
      ]);
      if (this.hdrPlaybackKey !== playbackKey) {
        this.hdrPlaybackKey = playbackKey;
        this.hdrPlaybackCheckedAt = 0;
      }

      if (this.currentPlaybackIsHdr === true && !recheck && this.hdrPlaybackCheckedAt) {
        return true;
      }

      const checkedAt = Number(this.hdrPlaybackCheckedAt || 0);
      if (
        !recheck &&
        this.currentPlaybackIsHdr !== true &&
        checkedAt &&
        (now - Number(this.hdrPlaybackFirstCheckedAt || now) > HDR_RECHECK_WINDOW_MS || now - checkedAt < HDR_RECHECK_MS)
      ) {
        return this.currentPlaybackIsHdr === true;
      }

      const status = readPlaybackHdrStatus(this, PlayerController);
      if (!status.ready) {
        return this.currentPlaybackIsHdr === true;
      }

      if (!this.hdrPlaybackFirstCheckedAt) {
        this.hdrPlaybackFirstCheckedAt = now;
      }
      this.hdrPlaybackCheckedAt = now;

      if (status.isHdr) {
        this.currentPlaybackIsHdr = true;
        return true;
      }
      if (this.currentPlaybackIsHdr === true && !status.confirmed) {
        return true;
      }
      this.currentPlaybackIsHdr = false;
      return false;
    },

    /** Applies the HDR subtitle colors and the control/menu brightness, once per change. */
    syncHdrPresentation({ force = false, recheck = false } = {}) {
      const uiRoot = this.uiRefs?.root;
      if (!uiRoot || !PlayerController.video) {
        return;
      }
      const wasHdr = this.currentPlaybackIsHdr === true;
      const isHdr = this.isCurrentPlaybackHdr({ recheck });
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
        if (wasHdr !== isHdr && this.subtitleDialogVisible) {
          this.renderSubtitleDialog?.();
        }
      }
    }
  };
}
