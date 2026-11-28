import { activeStreamLinkProfile } from "../../../data/local/streamLinkCacheStore.js";
/* eslint-disable no-unused-vars */
import * as internals from "./streamScreen.js";

export function createStreamScreenMethods03() {
  const {
    Router,
    ScreenUtils,
    streamRepository,
    PlayerSettingsStore,
    StreamPreferencesStore,
    StreamBadgeSettingsStore,
    ensureWebOsImageProxyReady,
    onWebOsImageProxyReady,
    clearFailedAddonLogos,
    normalizeAddonLogoLookup,
    preloadAddonLogoImages,
    Environment,
    ensureAddonLogoImageProxyReady
  } = internals;

  return {
    async mount(params = {}, navigationContext = {}) {
      streamRepository.setLocalPluginSearchPaused(false);
      this.container = document.getElementById("stream");
      ScreenUtils.show(this.container);
      this.params = params || {};
      this.bindStreamParty();
      this.streamLinkCacheProfileId = activeStreamLinkProfile();
      this.streamBackNavigationInProgress = false;
      this.stopStreamVirtualization();
      this.streamVirtualHeights = new Map();
      this.streamVirtualFocusReset = false;
      this.streamLastNavigationRepeatAt = 0;
      this.loadToken = (this.loadToken || 0) + 1;
      const token = this.loadToken;
      this.focusState = { zone: "filter", index: 1 };
      this.streamUserMovedFocus = false;
      this.streamInitialResultFocusAssigned = false;
      this.listScrollTop = 0;
      this.error = "";
      this.loading = true;
      this.streamSearchCompleted = false;
      this.streams = [];
      this.sourceChips = [];
      this.addonLogoLookup = {};
      this.addonFilter = "all";
      this.hasRenderedStreamRouteShell = false;
      this.renderedStreamListStable = false;
      this.renderedStreamListStreams = null;
      this.renderedStreamFocusStreams = null;
      this.renderedStreamListSourceChips = null;
      // Returning here from the player is a back navigation, not a fresh open, so
      // do not auto-resume or auto-play again. Otherwise exiting the player drops
      // back onto the stream list and immediately relaunches, looping forever.
      // Other back navigations must not inherit this behavior: opening the same
      // title again from Detail is a new stream search.
      const returningFromPlayer = Boolean(navigationContext?.isBackNavigation && navigationContext?.previousRoute === "player");
      this.autoResumeAttempted = returningFromPlayer;
      const playerSettings = PlayerSettingsStore.get();
      const reusableStream = playerSettings.streamReuseLastLinkEnabled
        ? StreamPreferencesStore.getValid(
            this.params?.itemId,
            this.params?.videoId || this.params?.itemId,
            Number(playerSettings.streamReuseLastLinkCacheHours || 24) * 60 * 60 * 1000
          )
        : null;
      this.autoResumeUiActive = Boolean(
        !navigationContext?.isBackNavigation &&
        this.params?.continueWatchingBackHome &&
        !this.params?.manualSelection &&
        reusableStream?.streamId &&
        (String(this.params?.resumeStreamIdentity || "").trim() || String(this.params?.preferredStreamId || "").trim())
      );
      this.autoPlayAttempted = returningFromPlayer;
      this.cancelAutoPlayCountdown();
      this.cancelAutoPlaySelectionWait();
      const autoPlayWaitSeconds = Math.max(0, Math.trunc(Number(playerSettings.streamAutoPlayTimeoutSeconds || 0)));
      this.autoPlaySelectionReady = autoPlayWaitSeconds === 0;
      if (autoPlayWaitSeconds > 0 && autoPlayWaitSeconds !== 2147483647) {
        this.autoPlaySelectionWaitTimer = setTimeout(() => {
          this.autoPlaySelectionWaitTimer = null;
          this.autoPlaySelectionReady = true;
          this.maybeAutoResumeStream();
          this.maybeAutoPlayStream();
        }, autoPlayWaitSeconds * 1000);
      }
      this.webOsNativePlayerAppId = "";
      this.nativePlayerPendingStreamId = "";
      this.nativePlayerRequestToken = 0;
      if (this.releaseImageProxyReadyListener) {
        this.releaseImageProxyReadyListener();
        this.releaseImageProxyReadyListener = null;
      }
      if (Environment.isWebOS()) {
        this.releaseImageProxyReadyListener = onWebOsImageProxyReady(() => {
          clearFailedAddonLogos();
          this.requestRender({ delayMs: 0 });
        });
        void ensureWebOsImageProxyReady();
        void this.detectWebOsNativePlayerApp();
      }

      // Match Android TV: restore the selected source only when returning from
      // playback. A fresh open of the same item must start from the first source
      // instead of inheriting an old list scroll/focus snapshot.
      const restored =
        returningFromPlayer && navigationContext?.restoredState && typeof navigationContext.restoredState === "object"
          ? navigationContext.restoredState
          : null;
      if (restored) {
        this.streamUserMovedFocus = true;
        this.streamInitialResultFocusAssigned = true;
        this.loading = Boolean(restored.loading);
        this.error = String(restored.error || "");
        this.streams = Array.isArray(restored.streams) ? restored.streams.map((stream) => ({ ...stream })) : [];
        this.addonFilter = String(restored.addonFilter || "all");
        this.focusState = restored.focusState ? { ...restored.focusState } : { zone: "filter", index: 1 };
        this.sourceChips = Array.isArray(restored.sourceChips) ? restored.sourceChips.map((chip) => ({ ...chip })) : [];
        this.addonLogoLookup =
          restored.addonLogoLookup && typeof restored.addonLogoLookup === "object"
            ? normalizeAddonLogoLookup(restored.addonLogoLookup)
            : {};
        this.streamSearchCompleted = Boolean(restored.streamSearchCompleted ?? !restored.loading);
        this.listScrollTop = Number(restored.listScrollTop || 0);
      }

      const showAddonLogo = StreamBadgeSettingsStore.snapshot().showAddonLogo === true;
      if (restored && this.streams.length && showAddonLogo) {
        await ensureAddonLogoImageProxyReady();
        if (token !== this.loadToken || Router.getCurrent() !== "stream") {
          return;
        }
        this.streams = this.applyAddonLogos(this.streams);
        await preloadAddonLogoImages(this.streams, this.addonLogoLookup);
        if (token !== this.loadToken || Router.getCurrent() !== "stream") {
          return;
        }
      }

      // A restored snapshot already holds visible stream results, so settle
      // `loading` before the first paint. If its shared search is still running,
      // the reattach below keeps filling the same list in the background.
      const restoringFromBack = Boolean(restored && navigationContext?.isBackNavigation && this.streams.length);
      if (restoringFromBack) {
        this.loading = false;
      }

      this.render();

      if (restoringFromBack) {
        // Android keeps the stream collector alive while the player is on top of
        // this screen. Reattach to the shared Web session when the restored
        // snapshot is only a partial result, instead of discarding late addon or
        // plugin groups after the player returns.
        if (!this.streamSearchCompleted) {
          void this.loadStreams({ preserveResults: true, forceRefresh: false });
        }
        return;
      }

      if (!navigationContext?.isBackNavigation && this.tryResumeCachedStreamLink()) return;

      // Match Android's initial stream load: reuse the repository-owned session
      // when its request key is still valid. Explicit refresh actions remain the
      // only path that force a new provider search.
      void this.loadStreams({ forceRefresh: false });
    }
  };
}
