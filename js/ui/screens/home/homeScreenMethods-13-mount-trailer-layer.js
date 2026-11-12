import * as internals from "./homeScreenContext.js";

export function createHomeScreenMethods13() {
  const { metaRepository, isCollectionFolderItem, resolveTrailerSource, withTimeout, resolveTrailerMetaWithTmdbFallback } = internals;

  return {
    mountTrailerLayer(container, source, onReady = null) {
      if (!container || !source) {
        return;
      }
      this.cancelTrailerLayerCleanup?.(container);
      const pendingHide = this.homeTrailerLayerHideTimers?.get?.(container);
      if (pendingHide) {
        clearTimeout(pendingHide);
        this.homeTrailerLayerHideTimers.delete(container);
      }
      container.classList.remove("is-trailer-layer-idle-hidden");
      if (source.kind === "youtube" && source.embedUrl) {
        const existingFrame = container.querySelector("iframe");
        if (existingFrame?.dataset?.trailerSrc === source.embedUrl) {
          // Same trailer already mounted: reveal it instead of clearing and
          // rebuilding the YouTube iframe, whose teardown is expensive on TV.
          try {
            existingFrame.contentWindow?.postMessage(
              {
                source: "nuvio-detail-trailer",
                type: "command",
                command: "play",
                payload: {}
              },
              "*"
            );
          } catch (_) {}
          container.classList.add("is-active");
          onReady?.();
          return;
        }
      }
      this.clearTrailerLayer(container);
      if (source.kind === "youtube" && source.embedUrl) {
        const frame = document.createElement("iframe");
        frame.className = "home-inline-trailer-frame";
        frame.dataset.trailerSrc = source.embedUrl;
        frame.src = source.embedUrl;
        frame.title = "Trailer preview";
        frame.allow = "autoplay; encrypted-media; picture-in-picture";
        frame.allowFullscreen = true;
        frame.referrerPolicy = "strict-origin-when-cross-origin";
        let revealTimer = 0;
        let fallbackTimer = 0;
        let revealed = false;
        const reveal = (delayMs = 0) => {
          if (revealed || revealTimer) {
            return;
          }
          revealTimer = setTimeout(() => {
            revealTimer = 0;
            if (revealed || !frame.isConnected || frame.parentElement !== container) {
              return;
            }
            revealed = true;
            frame.dataset.trailerRevealed = "true";
            if (fallbackTimer) {
              clearTimeout(fallbackTimer);
              fallbackTimer = 0;
            }
            container.classList.add("is-active");
            onReady?.();
          }, delayMs);
        };
        let lastTrailerTime = 0;
        const handleProxyMessage = (event) => {
          if (event?.source !== frame.contentWindow) {
            return;
          }
          const data = event?.data;
          if (!data || typeof data !== "object" || data.source !== "nuvio-youtube-proxy") {
            return;
          }
          if (data.type === "ended" || data.type === "error") {
            frame.dataset.ambientTrailerPlaying = "false";
          }
          if (data.type === "firstFrame") {
            frame.dataset.ambientTrailerPlaying = String(frame.dataset.ambientTrailerLooped !== "true");
            reveal(150);
            return;
          }
          const state = data.type === "state" && data.state && typeof data.state === "object" ? data.state : null;
          if (state) {
            // The embed loops; Android plays a trailer once and then lets the
            // idle period start, so only the first pass counts as playing.
            const time = Number(state.currentTime || 0);
            if (time + 1 < lastTrailerTime) {
              frame.dataset.ambientTrailerLooped = "true";
            }
            lastTrailerTime = time;
            frame.dataset.ambientTrailerPlaying = String(
              frame.dataset.ambientTrailerLooped !== "true" && state.paused === false && state.loading === false
            );
          }
          if (state && Number(state.currentTime || 0) > 0 && state.paused === false) {
            reveal(150);
          } else if (state && state.controllable === false && state.loading === false) {
            reveal(1200);
          }
        };
        const cleanup = () => {
          window.removeEventListener("message", handleProxyMessage);
          if (revealTimer) {
            clearTimeout(revealTimer);
            revealTimer = 0;
          }
          if (fallbackTimer) {
            clearTimeout(fallbackTimer);
            fallbackTimer = 0;
          }
        };
        this.homeTrailerFrameCleanup ||= new WeakMap();
        this.homeTrailerFrameCleanup.set(frame, cleanup);
        window.addEventListener("message", handleProxyMessage);
        frame.addEventListener(
          "load",
          () => {
            if (!revealed) {
              fallbackTimer = setTimeout(() => reveal(), 7000);
            }
          },
          { once: true }
        );
        container.appendChild(frame);
        return;
      }
      if (source.kind === "video" && source.url) {
        const shouldMute = source.muted !== false;
        const video = document.createElement("video");
        video.className = "home-inline-trailer-video";
        video.autoplay = true;
        video.loop = true;
        video.playsInline = true;
        video.defaultMuted = shouldMute;
        video.muted = shouldMute;
        video.preload = "auto";
        video.setAttribute("autoplay", "");
        video.setAttribute("loop", "");
        video.setAttribute("playsinline", "");
        video.setAttribute("webkit-playsinline", "");
        if (shouldMute) {
          video.setAttribute("muted", "");
        } else {
          video.removeAttribute("muted");
        }
        try {
          video.volume = shouldMute ? 0 : 1;
        } catch (_) {}
        try {
          video.disableRemotePlayback = true;
        } catch (_) {}

        let didActivate = false;
        const activate = () => {
          if (didActivate) {
            return;
          }
          didActivate = true;
          container.classList.add("is-active");
          onReady?.();
        };
        ["playing", "canplay", "loadeddata", "loadedmetadata", "timeupdate"].forEach((eventName) => {
          video.addEventListener(eventName, activate, { once: true });
        });
        let lastVideoTime = 0;
        video.addEventListener("timeupdate", () => {
          if (video.currentTime + 1 < lastVideoTime) {
            video.dataset.ambientTrailerLooped = "true";
          }
          lastVideoTime = video.currentTime;
        });
        video.addEventListener(
          "error",
          () => {
            console.warn("Home inline MP4 hero video failed", {
              url: String(source.url || ""),
              code: video.error?.code || 0,
              message: video.error?.message || ""
            });
          },
          { once: true }
        );
        container.appendChild(video);
        video.setAttribute("src", String(source.url || ""));
        try {
          video.load?.();
        } catch (_) {}
        const playAttempt = video.play?.();
        if (playAttempt?.then) {
          playAttempt.then(activate).catch((error) => {
            console.warn("Home inline MP4 hero video autoplay failed", error);
          });
        } else {
          setTimeout(() => {
            if (video.isConnected && !didActivate && Number(video.readyState || 0) >= 2) {
              activate();
            }
          }, 500);
        }
      }
    },
    collapseFocusedPoster(node = this.expandedPosterNode, options = {}) {
      // Avoid overlapping flex-size transitions that leave stale poster layers on
      // constrained TV generations and low-end devices.
      const instant = Boolean(options?.instant || this.isPerformanceConstrained());
      const preserveHeroMedia = Boolean(options?.preserveHeroMedia);
      const excludeNode = options?.excludeNode instanceof HTMLElement ? options.excludeNode : null;
      const targets = new Set();
      if (node instanceof HTMLElement && node !== excludeNode) {
        targets.add(node);
      }
      Array.from(
        this.container?.querySelectorAll(".home-main .home-poster-card.is-expanded, .home-main .home-poster-card.is-trailer-active") || []
      ).forEach((card) => {
        if (card !== excludeNode) {
          targets.add(card);
        }
      });
      targets.forEach((target) => {
        const frame = target?.querySelector?.(".home-poster-frame") || null;
        const previousCardTransition = instant && target instanceof HTMLElement ? target.style.transition : "";
        const previousFrameTransition = instant && frame instanceof HTMLElement ? frame.style.transition : "";
        if (instant && target instanceof HTMLElement) {
          target.style.setProperty("transition", "none", "important");
        }
        if (instant && frame instanceof HTMLElement) {
          frame.style.setProperty("transition", "none", "important");
        }
        target.classList.remove("is-expanded", "is-trailer-active", "is-expanded-backdrop-ready");
        const trailerLayer = target.querySelector(".home-poster-trailer-layer");
        // Tearing down a YouTube frame blocks the main thread for ~0.4s on TVs;
        // pause and hide now, destroy after the collapse/sidebar animation.
        this.scheduleTrailerLayerCleanup(trailerLayer);
        if (instant && target instanceof HTMLElement) {
          void target.offsetWidth;
          requestAnimationFrame(() => {
            if (target.isConnected) {
              target.style.transition = previousCardTransition;
            }
            if (frame instanceof HTMLElement && frame.isConnected) {
              frame.style.transition = previousFrameTransition;
            }
          });
        }
      });
      if (!preserveHeroMedia) {
        const heroLayer = this.container?.querySelector(".home-hero-trailer-layer");
        this.scheduleTrailerLayerCleanup(heroLayer);
        this.setHeroTrailerActive(false);
        this.heroTrailerPlaybackState = null;
      }
      if (!this.expandedPosterNode?.isConnected || !this.expandedPosterNode?.classList?.contains("is-expanded")) {
        this.expandedPosterNode = null;
      }
    },
    expandFocusedPoster(node) {
      if (!this.isModernPosterNode(node)) {
        return;
      }
      const hasOtherExpandedPosters = Array.from(
        this.container?.querySelectorAll(".home-main .home-poster-card.is-expanded, .home-main .home-poster-card.is-trailer-active") || []
      ).some((card) => card !== node);
      if ((this.expandedPosterNode && this.expandedPosterNode !== node) || hasOtherExpandedPosters) {
        this.collapseFocusedPoster(this.expandedPosterNode, { excludeNode: node });
      }
      node.classList.add("is-expanded");
      this.hydrateFocusedPosterAssets(node);
      this.expandedPosterNode = node;
      requestAnimationFrame(() => {
        if (node.classList.contains("focused")) {
          this.ensureTrackHorizontalVisibility(node);
        }
      });
    },
    async getTrailerSourceForItem(item) {
      if (isCollectionFolderItem(item)) {
        return null;
      }
      const itemId = String(item?.id || item?.contentId || "").trim();
      const itemType = String(item?.type || item?.apiType || "movie").trim() || "movie";
      if (!itemId) {
        return null;
      }
      try {
        const itemMeta = { ...(item || {}), id: itemId, type: itemType };
        const inlineFallbackSource = resolveTrailerSource(itemMeta);
        const addonMetaPromise = inlineFallbackSource
          ? Promise.resolve({ status: "error" })
          : withTimeout(metaRepository.getMetaFromAllAddons(itemType, itemId), 3200, {
              status: "error",
              message: "timeout"
            });
        const [inlineSource, result] = await Promise.all([
          withTimeout(resolveTrailerMetaWithTmdbFallback(itemMeta, itemType), 2200, null),
          addonMetaPromise
        ]);
        if (inlineSource) {
          return inlineSource;
        }
        if (inlineFallbackSource) {
          return inlineFallbackSource;
        }
        return result?.status === "success" ? resolveTrailerSource({ ...(result?.data || {}), id: itemId, type: itemType }) : null;
      } catch (error) {
        console.warn("Home trailer preview lookup failed", error);
        return null;
      }
    },
    prefetchFocusedPosterTrailer(node) {
      if (!this.isModernPosterNode(node) || this.isCollectionFolderNode(node)) {
        return Promise.resolve(null);
      }
      const flowKey = this.getFocusedPosterFlowKey(node);
      if (!flowKey) {
        return Promise.resolve(null);
      }
      this.focusedPosterTrailerSourcePromises ||= new Map();
      const cached = this.focusedPosterTrailerSourcePromises.get(flowKey);
      if (cached) {
        return cached;
      }
      const sourceItem = this.getNodeHeroSource(node);
      const promise = this.getTrailerSourceForItem(sourceItem).catch((error) => {
        console.warn("Home trailer preview prefetch failed", error);
        return null;
      });
      this.focusedPosterTrailerSourcePromises.set(flowKey, promise);
      // Keep this session cache bounded while retaining the Android-style
      // focus prefetch for recently visited cards.
      while (this.focusedPosterTrailerSourcePromises.size > 32) {
        const oldestKey = this.focusedPosterTrailerSourcePromises.keys().next().value;
        this.focusedPosterTrailerSourcePromises.delete(oldestKey);
      }
      return promise;
    }
  };
}
