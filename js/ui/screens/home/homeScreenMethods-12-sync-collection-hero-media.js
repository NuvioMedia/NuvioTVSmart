import * as internals from "./homeScreenContext.js";

export function createHomeScreenMethods12() {
  const { MODERN_HOME_CONSTANTS, firstNonEmpty, isCollectionFolderItem, normalizeCollectionFolderItem } = internals;

  return {
    syncCollectionHeroMedia(hero = null) {
      const heroLayer = this.container?.querySelector(".home-hero-trailer-layer");
      const heroMedia = this.container?.querySelector(".home-modern-hero-media");
      const activeHero = isCollectionFolderItem(hero) ? normalizeCollectionFolderItem(hero) : null;
      const videoUrl = firstNonEmpty(activeHero?.heroVideoUrl);
      const playbackKey = videoUrl && activeHero ? `${activeHero.collectionId}:${activeHero.folderId}:${videoUrl}` : "";
      if (!heroLayer || !heroMedia || !playbackKey) {
        if (this.collectionHeroMediaKey) {
          this.collectionHeroMediaKey = "";
          this.clearTrailerLayer(heroLayer);
          this.setHeroTrailerActive(false, heroMedia);
        }
        return;
      }
      if (this.collectionHeroMediaKey === playbackKey && heroLayer.querySelector("video")) {
        if (heroLayer.classList.contains("is-active")) {
          this.setHeroTrailerActive(true, heroMedia);
        }
        return;
      }
      this.collectionHeroMediaKey = playbackKey;
      this.heroTrailerPlaybackState = null;
      this.setHeroTrailerActive(false, heroMedia);
      this.mountTrailerLayer(heroLayer, { kind: "video", url: videoUrl, muted: true }, () => {
        if (this.collectionHeroMediaKey === playbackKey) {
          this.setHeroTrailerActive(true, heroMedia);
        }
      });
    },
    hydrateFocusedPosterAssets(node, { defer = false } = {}) {
      if (!this.isModernPosterNode(node)) {
        return;
      }
      const hydrate = () => {
        const backdrop = node.querySelector(".home-poster-expanded-backdrop");
        if (backdrop?.tagName === "IMG") {
          const src = String(backdrop.dataset.src || backdrop.getAttribute("src") || "").trim();
          const markBackdropReady = () => {
            if (node.isConnected) {
              node.classList.add("is-expanded-backdrop-ready");
            }
            backdrop.dataset.loadState = "ready";
          };
          const markBackdropPending = () => {
            node.classList.remove("is-expanded-backdrop-ready");
            backdrop.dataset.loadState = src ? "pending" : "";
          };
          if (src && !backdrop.getAttribute("src")) {
            backdrop.setAttribute("src", src);
          }
          if (backdrop.complete && Number(backdrop.naturalWidth || 0) > 0) {
            markBackdropReady();
          } else if (src) {
            markBackdropPending();
            if (backdrop.dataset.loadBound !== "true") {
              backdrop.dataset.loadBound = "true";
              backdrop.addEventListener(
                "load",
                () => {
                  markBackdropReady();
                },
                { once: true }
              );
              backdrop.addEventListener(
                "error",
                () => {
                  if (node.isConnected) {
                    node.classList.remove("is-expanded-backdrop-ready");
                  }
                  backdrop.dataset.loadState = "error";
                  backdrop.dataset.loadBound = "false";
                },
                { once: true }
              );
            }
          } else {
            markBackdropPending();
          }
          backdrop.removeAttribute("data-src");
        } else {
          node.classList.remove("is-expanded-backdrop-ready");
        }
        const logo = node.querySelector(".home-poster-expanded-logo[data-src]");
        if (logo) {
          const src = String(logo.dataset.src || "").trim();
          if (src && !logo.getAttribute("src")) {
            logo.setAttribute("src", src);
          }
          logo.removeAttribute("data-src");
        }
      };
      if (!defer) {
        hydrate();
        return;
      }
      const run = () => {
        if (!node.isConnected || !node.classList.contains("is-expanded")) {
          return;
        }
        hydrate();
      };
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(run, { timeout: 400 });
      } else {
        setTimeout(run, 0);
      }
    },
    promotePosterCardAssets(node, { includeNeighbors = false } = {}) {
      const promoteCard = (card, isPrimary = false) => {
        if (!this.isModernPosterNode(card)) {
          return;
        }
        const poster = card.querySelector(".content-poster");
        if (poster instanceof HTMLImageElement) {
          poster.loading = "eager";
          poster.decoding = "async";
          if (isPrimary) {
            try {
              poster.fetchPriority = "high";
            } catch (_) {}
          }
        }
        if (isPrimary) {
          this.hydrateFocusedPosterAssets(card);
        }
      };

      promoteCard(node, true);
      if (!includeNeighbors) {
        return;
      }
      const siblings = Array.from(node?.closest(".home-track")?.querySelectorAll(".home-poster-card") || []);
      const index = siblings.indexOf(node);
      [siblings[index - 1], siblings[index + 1]].forEach((sibling) => {
        if (sibling) {
          promoteCard(sibling, false);
        }
      });
    },
    clearTrailerLayer(container) {
      if (!container) {
        return;
      }
      const pendingCleanup = this.homeTrailerLayerCleanupTimers?.get?.(container);
      // Home mounts an empty trailer layer for every poster. Leaving Home used
      // to traverse and clear all of those no-op nodes synchronously, which is
      // avoidable on constrained TV runtimes. Keep handling active, populated,
      // and scheduled layers so trailer teardown semantics remain unchanged.
      if (!container.classList.contains("is-active") && !container.firstElementChild && !pendingCleanup) {
        return;
      }
      if (pendingCleanup) {
        if (pendingCleanup.idleId) {
          globalThis.cancelIdleCallback?.(pendingCleanup.idleId);
        }
        if (pendingCleanup.timeoutId) {
          clearTimeout(pendingCleanup.timeoutId);
        }
        this.homeTrailerLayerCleanupTimers.delete(container);
      }
      this.pauseTrailerLayer(container);
      const activeFrame = container.querySelector("iframe");
      if (activeFrame) {
        this.homeTrailerFrameCleanup?.get(activeFrame)?.();
        this.homeTrailerFrameCleanup?.delete(activeFrame);
        try {
          activeFrame.src = "about:blank";
        } catch (_) {}
        try {
          activeFrame.removeAttribute("src");
        } catch (_) {}
      }
      const activeVideo = container.querySelector("video");
      if (activeVideo) {
        try {
          activeVideo.removeAttribute("src");
          activeVideo.load?.();
        } catch (_) {}
      }
      container.innerHTML = "";
      container.classList.remove("is-active");
    },
    pauseTrailerLayer(container) {
      if (!container) {
        return;
      }
      const activeFrame = container.querySelector("iframe");
      if (activeFrame) {
        activeFrame.dataset.ambientTrailerPlaying = "false";
        try {
          activeFrame.contentWindow?.postMessage(
            {
              source: "nuvio-detail-trailer",
              type: "command",
              command: "pause",
              payload: {}
            },
            "*"
          );
        } catch (_) {}
      }
      const activeVideo = container.querySelector("video");
      if (activeVideo) {
        try {
          activeVideo.pause();
        } catch (_) {}
      }
    },
    scheduleTrailerLayerCleanup(container) {
      if (!container) {
        return;
      }
      this.pauseTrailerLayer(container);
      this.homeTrailerLayerCleanupTimers ||= new WeakMap();
      const pendingCleanup = this.homeTrailerLayerCleanupTimers.get(container);
      if (pendingCleanup) {
        if (pendingCleanup.idleId) {
          globalThis.cancelIdleCallback?.(pendingCleanup.idleId);
        }
        if (pendingCleanup.timeoutId) {
          clearTimeout(pendingCleanup.timeoutId);
        }
      }
      const cleanupState = { idleId: 0, timeoutId: 0, completed: false };
      const cleanup = () => {
        if (cleanupState.completed) {
          return;
        }
        cleanupState.completed = true;
        if (cleanupState.idleId) {
          globalThis.cancelIdleCallback?.(cleanupState.idleId);
        }
        if (cleanupState.timeoutId) {
          clearTimeout(cleanupState.timeoutId);
        }
        this.homeTrailerLayerCleanupTimers.delete(container);
        this.clearTrailerLayer(container);
      };
      cleanupState.timeoutId = setTimeout(() => {
        cleanupState.timeoutId = 0;
        if (typeof globalThis.requestIdleCallback === "function") {
          cleanupState.idleId = globalThis.requestIdleCallback(cleanup, { timeout: 120 });
          return;
        }
        cleanup();
      }, MODERN_HOME_CONSTANTS.smartTvTrailerCleanupDelayMs);
      this.homeTrailerLayerCleanupTimers.set(container, cleanupState);
      container.classList.remove("is-active");
    },
    refreshPendingHomeTrailerCleanup() {
      if (!this.shouldUseImmediateFocusScroll()) {
        return;
      }
      const layers = this.container?.querySelectorAll(".home-poster-trailer-layer, .home-hero-trailer-layer");
      layers?.forEach((layer) => {
        const hasPendingCleanup = this.homeTrailerLayerCleanupTimers?.has?.(layer);
        if (hasPendingCleanup || layer.querySelector("iframe, video")) {
          this.scheduleTrailerLayerCleanup(layer);
        }
      });
    },
    clearHomeTrailerLayers() {
      const layers = this.container?.querySelectorAll(".home-poster-trailer-layer, .home-hero-trailer-layer");
      layers?.forEach((layer) => this.clearTrailerLayer(layer));
    },
    setHeroTrailerActive(active = false, heroMedia = null) {
      const isActive = Boolean(active);
      const media = heroMedia || this.container?.querySelector(".home-modern-hero-media");
      media?.classList.toggle("trailer-active", isActive);
      this.container?.querySelector(".home-modern-stage")?.classList.toggle("is-hero-trailer-active", isActive);
    },
    restorePersistentHeroTrailer(node, options = {}) {
      if (!this.isModernPosterNode(node)) {
        return false;
      }
      const shouldExpand = Boolean(options?.shouldExpand);
      const shouldPreviewTrailer = Boolean(options?.shouldPreviewTrailer);
      const trailerTarget = String(options?.trailerTarget || "hero_media").toLowerCase();
      const flowKey = String(options?.flowKey || this.getFocusedPosterFlowKey(node) || "");
      if (shouldExpand) {
        this.expandFocusedPoster(node);
      }
      if (!shouldPreviewTrailer || trailerTarget !== "hero_media" || !flowKey) {
        return false;
      }
      const cachedState = this.heroTrailerPlaybackState;
      if (!cachedState?.source || String(cachedState.key || "") !== flowKey) {
        return false;
      }
      const heroLayer = this.container?.querySelector(".home-hero-trailer-layer");
      const heroMedia = this.container?.querySelector(".home-modern-hero-media");
      if (!heroLayer || !heroMedia) {
        return false;
      }
      this.setHeroTrailerActive(false, heroMedia);
      this.mountTrailerLayer(heroLayer, cachedState.source, () => {
        if (node.classList.contains("focused") && String(this.getFocusedPosterFlowKey(node) || "") === flowKey) {
          this.setHeroTrailerActive(true, heroMedia);
        }
      });
      return true;
    },
    getFocusedPosterFlowConfig(prefs = this.layoutPrefs || {}) {
      const useLandscapePosters = Boolean(prefs.modernLandscapePostersEnabled);
      const expandSettingEnabled = Boolean(prefs.focusedPosterBackdropExpandEnabled);
      const requestedTrailerTarget =
        String(prefs.focusedPosterBackdropTrailerPlaybackTarget || "hero_media").toLowerCase() === "expanded_card"
          ? "expanded_card"
          : "hero_media";
      const trailerEnabled = Boolean(prefs.focusedPosterBackdropTrailerEnabled) && !this.shouldSuppressAutomaticTrailerPlayback();
      const shouldPreviewTrailer = trailerEnabled && (useLandscapePosters || expandSettingEnabled);
      const landscapeExpandedCardMode = useLandscapePosters && shouldPreviewTrailer && requestedTrailerTarget === "expanded_card";
      const suppressCardExpansionForHeroTrailer = shouldPreviewTrailer && requestedTrailerTarget === "hero_media";
      const shouldExpand =
        !suppressCardExpansionForHeroTrailer && ((expandSettingEnabled && !useLandscapePosters) || landscapeExpandedCardMode);
      return {
        shouldExpand,
        shouldPreviewTrailer,
        trailerTarget: shouldExpand ? requestedTrailerTarget : "hero_media"
      };
    }
  };
}
