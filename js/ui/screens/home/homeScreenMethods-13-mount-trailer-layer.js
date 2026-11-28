import * as internals from "./homeScreenContext.js";
import { withResolvedTrailerSource } from "../../../core/media/trailerApi.js";

// YouTube draws its own startup chrome (title, share, transport controls) even
// with controls=0 and only hides it a few seconds after playback starts. Keep
// the layer covered by the backdrop until then so Home previews stay as clean
// as Android's chromeless trailer player.
const YOUTUBE_TRAILER_CHROME_SETTLE_MS = 4500;
// The raw fallback embed has no API signal: its window starts at the iframe
// load state, which arrives before the player paints.
const YOUTUBE_FALLBACK_CHROME_SETTLE_MS = 5000;

function setTrailerFrameMuted(frame, muted) {
  try {
    frame.contentWindow?.postMessage(
      {
        source: "nuvio-detail-trailer",
        type: "command",
        command: "setMuted",
        payload: { muted: Boolean(muted) }
      },
      "*"
    );
  } catch (_) {}
}

export function createHomeScreenMethods13() {
  const {
    metaRepository,
    isCollectionFolderItem,
    resolveTrailerSource,
    withTimeout,
    resolveTrailerMetaWithTmdbFallback,
    extractYear,
    LayoutPreferences
  } = internals;

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
          // The proxy holds audio until a reveal; a re-focused trailer has
          // already been revealed once, so restore its sound here.
          if (source.muted === false) {
            setTrailerFrameMuted(existingFrame, false);
          }
          container.classList.add("is-active");
          (this.mountedHomeTrailerLayers ||= new Set()).add(container);
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
        frame.tabIndex = -1;
        frame.inert = true;
        frame.setAttribute?.("tabindex", "-1");
        frame.setAttribute?.("aria-hidden", "true");
        frame.setAttribute?.("inert", "");
        let revealTimer = 0;
        let fallbackTimer = 0;
        let revealed = false;
        let proxyReadyReceived = false;
        let focusReclaimTimer = 0;
        const reclaimHomeFocusFromFrame = () => {
          if (focusReclaimTimer || typeof document === "undefined" || document.activeElement !== frame) {
            return;
          }
          // A cross-origin iframe keeps keyboard routing until the focus change
          // completes, so blur() synchronously here is silently ignored. Defer
          // the reclaim by one task, otherwise the TV remote stays captured.
          focusReclaimTimer = setTimeout(() => {
            focusReclaimTimer = 0;
            if (typeof document === "undefined" || document.activeElement !== frame) {
              return;
            }
            try {
              frame.blur?.();
            } catch (_) {}
            const focused = this.container?.querySelector?.(".focusable.focused") || this.container?.querySelector?.(".focusable") || null;
            if (focused) {
              try {
                focused.focus?.({ preventScroll: true });
              } catch (_) {
                focused.focus?.();
              }
            }
          }, 0);
        };
        const abortFailedTrailer = () => {
          frame.dataset.ambientTrailerPlaying = "false";
          if (container.classList?.contains?.("home-hero-trailer-layer")) {
            this.setHeroTrailerActive?.(false);
            this.heroTrailerPlaybackState = null;
          } else {
            container.closest?.(".home-poster-card")?.classList?.remove?.("is-trailer-active");
          }
          this.clearTrailerLayer(container);
        };
        const reveal = (delayMs = 0) => {
          if (revealed || revealTimer) {
            return;
          }
          revealTimer = setTimeout(() => {
            revealTimer = 0;
            if (revealed || !frame.isConnected || frame.parentElement !== container) {
              return;
            }
            // Focus moved away while the startup chrome was settling: the layer
            // was paused and hidden, so a late reveal would bring back a still.
            if (frame.dataset.ambientTrailerPlaying === "false") {
              return;
            }
            revealed = true;
            frame.dataset.trailerRevealed = "true";
            if (fallbackTimer) {
              clearTimeout(fallbackTimer);
              fallbackTimer = 0;
            }
            container.classList.add("is-active");
            // Home keeps the layer covered until YouTube's startup chrome
            // settles, so the proxy holds its audio until this reveal.
            if (source.muted === false) {
              setTrailerFrameMuted(frame, false);
            }
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
          if (data.type === "ready") {
            proxyReadyReceived = true;
            return;
          }
          if (data.type === "error") {
            abortFailedTrailer();
            return;
          }
          if (data.type === "ended") {
            frame.dataset.ambientTrailerPlaying = "false";
          }
          if (data.type === "firstFrame") {
            frame.dataset.ambientTrailerPlaying = String(frame.dataset.ambientTrailerLooped !== "true");
            reveal(YOUTUBE_TRAILER_CHROME_SETTLE_MS);
            return;
          }
          const state = data.type === "state" && data.state && typeof data.state === "object" ? data.state : null;
          if (state && proxyReadyReceived && state.controllable === false) {
            abortFailedTrailer();
            return;
          }
          if (state) {
            this.trackHomeTrailerHandoff?.(container, source, state);
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
            reveal(YOUTUBE_TRAILER_CHROME_SETTLE_MS);
          } else if (state && state.controllable === false && state.loading === false) {
            reveal(YOUTUBE_FALLBACK_CHROME_SETTLE_MS);
          }
        };
        const cleanup = () => {
          window.removeEventListener("message", handleProxyMessage);
          window.removeEventListener?.("blur", reclaimHomeFocusFromFrame);
          if (focusReclaimTimer) {
            clearTimeout(focusReclaimTimer);
            focusReclaimTimer = 0;
          }
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
        window.addEventListener?.("blur", reclaimHomeFocusFromFrame);
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
        (this.mountedHomeTrailerLayers ||= new Set()).add(container);
        return;
      }
      if (source.kind === "video" && source.url) {
        const shouldMute = source.muted !== false;
        const video = document.createElement("video");
        video.className = "home-inline-trailer-video";
        video.autoplay = true;
        video.loop = true;
        video.playsInline = true;
        video.defaultMuted = true;
        video.muted = true;
        video.preload = "auto";
        video.setAttribute("autoplay", "");
        video.setAttribute("loop", "");
        video.setAttribute("playsinline", "");
        video.setAttribute("webkit-playsinline", "");
        video.setAttribute("muted", "");
        try {
          video.disableRemotePlayback = true;
        } catch (_) {}

        let didActivate = false;
        const activate = () => {
          if (didActivate || video.isConnected === false || (video.parentElement && video.parentElement !== container)) {
            return;
          }
          didActivate = true;
          container.classList.add("is-active");
          if (!shouldMute) {
            const settleUnmute = () => {
              if (video.muted || video.isConnected === false || !container.classList?.contains?.("is-active")) {
                return;
              }
              // Autoplay policy paused the unmuted trailer: resume it muted so
              // the reveal never lands on a frozen frame.
              if (!video.paused) {
                return;
              }
              video.muted = true;
              video.setAttribute?.("muted", "");
              const retryPlay = video.play?.();
              if (retryPlay?.catch) {
                retryPlay.catch(() => {});
              }
            };
            video.muted = false;
            video.removeAttribute?.("muted");
            if (video.paused) {
              settleUnmute();
            } else {
              setTimeout(settleUnmute, 120);
            }
          }
          onReady?.();
        };
        const tryActivateOnPlaybackFrame = () => {
          if (didActivate) {
            return;
          }
          if (Number(video.readyState || 0) >= 2 && !video.paused) {
            activate();
          }
        };
        if (typeof video.requestVideoFrameCallback === "function") {
          video.requestVideoFrameCallback(() => {
            activate();
          });
        } else {
          video.addEventListener("playing", tryActivateOnPlaybackFrame);
        }
        let lastVideoTime = 0;
        const syncTrailerState = () => {
          if (Number(video.currentTime || 0) > 0) {
            tryActivateOnPlaybackFrame();
          }
          if (video.currentTime + 1 < lastVideoTime) {
            video.dataset.ambientTrailerLooped = "true";
          }
          lastVideoTime = video.currentTime;
          this.trackHomeTrailerHandoff?.(container, source, {
            currentTime: Number(video.currentTime || 0),
            muted: shouldMute || Boolean(video.muted),
            paused: Boolean(video.paused)
          });
        };
        ["timeupdate", "play", "pause"].forEach((eventName) => {
          video.addEventListener(eventName, syncTrailerState);
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
        (this.mountedHomeTrailerLayers ||= new Set()).add(container);
        video.setAttribute("src", String(source.url || ""));
        try {
          video.load?.();
        } catch (_) {}
        const playAttempt = video.play?.();
        if (playAttempt?.catch) {
          playAttempt.catch((error) => {
            console.warn("Home inline MP4 hero video autoplay failed", error);
          });
        } else {
          setTimeout(() => {
            if (video.isConnected && !didActivate && Number(video.readyState || 0) >= 2 && !video.paused) {
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
          this.revealExpandedPosterTrailingEdge(node);
        }
      });
    },
    getExpandedPosterWidth(node) {
      if (!node?.classList?.contains("is-landscape")) {
        const shell = this.container?.querySelector(".home-screen-shell");
        const metrics = shell ? this.getCachedModernPortraitPosterMetrics(shell) : null;
        if (Number(metrics?.expandedWidth) > 0) {
          return Number(metrics.expandedWidth);
        }
      }
      return Number(node?.offsetWidth || 0);
    },
    revealExpandedPosterTrailingEdge(node) {
      const track = node?.closest?.(".home-track");
      if (!track) {
        return;
      }
      // Android reveals only the expanded card's trailing edge, plus a small
      // margin. Realigning the card instead would drag the whole row under a
      // hovering pointer and turn the expansion into another hover target.
      const metrics = this.getTrackViewportMetrics(track);
      const trackRect = track.getBoundingClientRect();
      const nodeRect = node.getBoundingClientRect();
      const visibleRight = trackRect.left + Number(track.clientWidth || 0) - metrics.safeRightPadding;
      const overshoot = nodeRect.left + this.getExpandedPosterWidth(node) - visibleRight;
      if (overshoot <= 0) {
        return;
      }
      this.animateScroll(track, "x", Number(track.scrollLeft || 0) + overshoot + 30, this.getScrollDuration(160));
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
        const source =
          inlineSource ||
          inlineFallbackSource ||
          (result?.status === "success" ? resolveTrailerSource({ ...(result?.data || {}), id: itemId, type: itemType }) : null);
        return withResolvedTrailerSource(source, {
          title: String(itemMeta.name || "").trim(),
          year: extractYear(itemMeta)
        });
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
    },
    trackHomeTrailerHandoff(container, source, state) {
      const card = container?.closest?.(".home-poster-card") || null;
      const heroState = this.heroTrailerPlaybackState;
      const itemKey = card ? this.getFocusedPosterFlowKey(card) : String(heroState?.key || "");
      if (!itemKey || (!source?.ytId && !source?.url)) {
        // Direct <video> trailers have no YouTube id, but their progress feeds
        // the same Home-to-detail handoff.
        return;
      }
      this.homeTrailerHandoff = {
        itemKey,
        ytId: String(source.ytId || ""),
        currentTime: Math.max(0, Number(state?.currentTime || 0)),
        muted: state?.muted === true,
        paused: state?.paused !== false,
        updatedAt: Date.now()
      };
    },
    getTrailerHandoffForNode(node, item = {}) {
      if (LayoutPreferences.get().focusedPosterTrailerContinueInDetails !== true) {
        return null;
      }
      const handoff = this.homeTrailerHandoff;
      if (!handoff || handoff.paused || !(handoff.currentTime > 0) || Date.now() - Number(handoff.updatedAt || 0) > 3000) {
        return null;
      }
      const key = item.itemId ? `${String(item.itemType || "movie").toLowerCase()}:${item.itemId}` : this.getFocusedPosterFlowKey(node);
      if (key && handoff.itemKey && handoff.itemKey !== key) {
        return null;
      }
      return {
        ytId: handoff.ytId,
        currentTime: handoff.currentTime,
        muted: handoff.muted === true
      };
    }
  };
}
