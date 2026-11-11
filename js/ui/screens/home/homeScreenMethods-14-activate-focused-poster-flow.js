import { registerHomeDomNodes } from "./homeDomUpdate.js";
import * as internals from "./homeScreenContext.js";
import { getTrailerMountGraceMs } from "../../../platform/tvPerformancePolicy.js";

export function createHomeScreenMethods14() {
  const { applyTrailerAudioPreferences, getTvRuntimePerformanceProfile } = internals;

  return {
    async activateFocusedPosterFlow(node, flowToken = Number(this.focusedPosterFlowToken || 0)) {
      if (!this.isModernPosterNode(node) || !node.classList.contains("focused")) {
        return;
      }
      if (this.isCollectionFolderNode(node)) {
        this.collapseFocusedPoster(this.expandedPosterNode, {
          instant: true,
          preserveHeroMedia: this.shouldPreserveCollectionHeroMedia(node)
        });
        await new Promise((resolve) => {
          setTimeout(resolve, 140);
        });
        if (!node.classList.contains("focused") || Number(this.focusedPosterFlowToken || 0) !== Number(flowToken || 0)) {
          return;
        }
        this.hydrateCollectionFocusGif(node, true);
        return;
      }
      const prefs = this.layoutPrefs || {};
      const { shouldExpand, shouldPreviewTrailer, trailerTarget } = this.getFocusedPosterFlowConfig(prefs);
      if (shouldExpand) {
        this.expandFocusedPoster(node);
      }
      if (!shouldPreviewTrailer) {
        return;
      }
      const trailerDelayMs = this.getFocusedPosterTrailerDelayMs(trailerTarget);
      if (trailerDelayMs > 0) {
        await new Promise((resolve) => {
          setTimeout(resolve, trailerDelayMs);
        });
        if (Number(this.focusedPosterFlowToken || 0) !== Number(flowToken || 0) || !node.classList.contains("focused")) {
          return;
        }
      }
      const mountGraceMs = getTrailerMountGraceMs(getTvRuntimePerformanceProfile());
      if (mountGraceMs > 0) {
        // Modern TVs defer the YouTube iframe mount until focus has been quiet
        // for a moment. Constrained generations keep the previous timing.
        const sinceNavigation = Date.now() - Number(this.lastModernHeroNavAt || 0);
        const remainingGraceMs = mountGraceMs - sinceNavigation;
        if (remainingGraceMs > 0) {
          await new Promise((resolve) => {
            setTimeout(resolve, remainingGraceMs);
          });
          if (Number(this.focusedPosterFlowToken || 0) !== Number(flowToken || 0) || !node.classList.contains("focused")) {
            return;
          }
        }
      }

      const baseSource = await this.prefetchFocusedPosterTrailer(node);
      if (Number(this.focusedPosterFlowToken || 0) !== Number(flowToken || 0)) {
        return;
      }
      const source = applyTrailerAudioPreferences(baseSource, prefs);
      if (!source || !node.classList.contains("focused")) {
        return;
      }
      const flowKey = this.getFocusedPosterFlowKey(node);

      if (trailerTarget === "expanded_card" && shouldExpand) {
        this.heroTrailerPlaybackState = null;
        const trailerLayer = node.querySelector(".home-poster-trailer-layer");
        if (trailerLayer) {
          this.mountTrailerLayer(trailerLayer, source, () => {
            if (node.classList.contains("focused") && Number(this.focusedPosterFlowToken || 0) === Number(flowToken || 0)) {
              node.classList.add("is-trailer-active");
            }
          });
        }
        return;
      }

      const heroLayer = this.container?.querySelector(".home-hero-trailer-layer");
      const heroMedia = this.container?.querySelector(".home-modern-hero-media");
      if (heroLayer && heroMedia) {
        this.heroTrailerPlaybackState = {
          key: flowKey,
          source
        };
        this.mountTrailerLayer(heroLayer, source, () => {
          if (node.classList.contains("focused") && Number(this.focusedPosterFlowToken || 0) === Number(flowToken || 0)) {
            this.setHeroTrailerActive(true, heroMedia);
          }
        });
      }
    },
    cancelFocusedPosterFlow() {
      if (this.focusedPosterTimer) {
        clearTimeout(this.focusedPosterTimer);
        this.focusedPosterTimer = null;
      }
      if (this.focusedPosterTrailerPrefetchTimer) {
        clearTimeout(this.focusedPosterTrailerPrefetchTimer);
        this.focusedPosterTrailerPrefetchTimer = null;
      }
      this.focusedPosterFlowToken = Number(this.focusedPosterFlowToken || 0) + 1;
    },
    clearFocusedPosterFlowState() {
      this.focusedPosterFlowState = null;
    },
    getFocusedPosterFlowKey(node) {
      const heroSource = this.getNodeHeroSource(node);
      const itemId = String(node?.dataset?.itemId || node?.dataset?.contentId || heroSource?.id || "").trim();
      const itemType = String(node?.dataset?.itemType || heroSource?.type || "")
        .trim()
        .toLowerCase();
      if (!itemId) {
        return "";
      }
      return `${itemType}:${itemId}`;
    },
    scheduleHomeTruncationUpdate({ scope = null } = {}) {
      if (!this.container) {
        return;
      }
      if (this.layoutMode === "modern") {
        // Measuring here forced a layout in the middle of every hero update,
        // two or three times per focus: 17 ms each on a 2025 OLED. The previous
        // bounds stay applied meanwhile and CSS clamps the text, so one
        // measurement at the start of the next frame is enough.
        if (!this.homeHeroBoundsFrame) {
          this.homeHeroBoundsFrame = requestAnimationFrame(() => {
            this.homeHeroBoundsFrame = 0;
            this.applyModernHeroDescriptionBounds(this.container);
          });
        }
        return;
      }
      // Tizen fast path: the binary-search textContent loop below forces
      // dozens of reflows per render. Fast-path runtimes already get pure
      // CSS ellipsis/line-clamp (see components-45.css), so skip the JS pass.
      try {
        if (typeof this.isPerformanceConstrained === "function" && this.isPerformanceConstrained()) {
          return;
        }
      } catch (_) {}
      try {
        if (
          globalThis?.document?.body?.classList?.contains("legacy-tizen") ||
          globalThis?.document?.documentElement?.classList?.contains("legacy-tizen")
        ) {
          return;
        }
      } catch (_) {}
      this.homeTruncationScope = scope || null;
      if (this.homeTruncationFrame) {
        cancelAnimationFrame(this.homeTruncationFrame);
      }
      this.homeTruncationFrame = requestAnimationFrame(() => {
        this.homeTruncationFrame = null;
        this.applyHomeTruncationState();
      });
    },
    applyHomeTruncationState() {
      if (!this.container) {
        return;
      }
      const root = this.homeTruncationScope || this.container;
      this.homeTruncationScope = null;
      this.applyModernHeroDescriptionBounds(root);
      if (this.layoutMode === "modern") {
        return;
      }
      // Modern Home hides .home-poster-copy; classic/grid still render those
      // labels and therefore keep the measured truncation path.
      const truncationSelector =
        this.layoutMode === "modern" ? ".home-hero-description" : ".home-hero-description, .home-poster-title, .home-poster-subtitle";
      const nodes = root.querySelectorAll(truncationSelector);
      nodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) {
          return;
        }
        const currentText = node.textContent ?? "";
        const storedText = node.dataset.fullText || "";
        const shouldRefresh = !storedText || (currentText && currentText !== storedText && !currentText.trim().endsWith("..."));
        const sourceText = shouldRefresh ? currentText : storedText;
        const fullText = sourceText;
        if (!fullText) {
          return;
        }
        node.dataset.fullText = fullText;
        node.textContent = fullText;
        const fits = node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1;
        if (fits) {
          node.classList.remove("is-truncated");
          return;
        }

        const ellipsis = "...";
        let low = 0;
        let high = fullText.length;
        while (low < high) {
          const mid = Math.ceil((low + high) / 2);
          node.textContent = `${fullText.slice(0, mid).trimEnd()}${ellipsis}`;
          const overflows = node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1;
          if (overflows) {
            high = mid - 1;
          } else {
            low = mid;
          }
        }
        const finalText = `${fullText.slice(0, Math.max(0, low)).trimEnd()}${ellipsis}`;
        node.textContent = finalText;
        node.classList.add("is-truncated");
      });
      registerHomeDomNodes(Array.from(nodes).filter((node) => node instanceof HTMLElement));
    },
    applyModernHeroDescriptionBounds(root = null) {
      if (!this.container || this.layoutMode !== "modern") {
        return;
      }
      const modernHeroDescriptionMaxLines = 4;
      const scope = root instanceof HTMLElement ? root : this.container;
      const heroNodes = scope.classList?.contains("home-hero-card") ? [scope] : Array.from(scope.querySelectorAll(".home-hero-card"));
      heroNodes.forEach((heroNode) => {
        const description = heroNode.querySelector(".home-hero-description");
        if (!(description instanceof HTMLElement)) {
          return;
        }

        if (description.classList.contains("is-empty")) {
          return;
        }

        const descriptionStyle = getComputedStyle(description);
        const lineHeight = parseFloat(descriptionStyle.lineHeight || "0") || 0;
        const fontSize = parseFloat(descriptionStyle.fontSize || "0") || 0;
        const lineBoxHeight = Math.max(1, Math.ceil(lineHeight || fontSize * 1.35 || description.offsetHeight || 1));
        const copy = description.closest(".home-modern-hero-copy");
        const siblings = copy
          ? Array.from(copy.children).filter((node) => node !== description && getComputedStyle(node).display !== "none")
          : [];
        const spacing = copy ? parseFloat(getComputedStyle(copy).rowGap || "0") || 0 : 0;
        const occupiedHeight = siblings.reduce((height, node) => height + node.getBoundingClientRect().height, 0);
        const availableHeight = copy
          ? copy.clientHeight - occupiedHeight - spacing * siblings.length
          : lineBoxHeight * modernHeroDescriptionMaxLines;
        const lines = Math.min(modernHeroDescriptionMaxLines, Math.max(0, Math.floor(availableHeight / lineBoxHeight)));
        const maxHeight = `${lineBoxHeight * lines}px`;
        const lineClamp = String(Math.max(1, lines));
        if (description.style.maxHeight !== maxHeight) {
          description.style.maxHeight = maxHeight;
        }
        if (description.style.webkitLineClamp !== lineClamp) {
          description.style.webkitLineClamp = lineClamp;
        }
      });
    },
    ensureHomeTruncationObservers() {
      if (this.homeTruncationObserversBound || this.isPerformanceConstrained()) {
        return;
      }
      this.homeTruncationObserversBound = true;
      if (globalThis?.document?.fonts?.ready) {
        document.fonts.ready
          .then(() => {
            this.scheduleHomeTruncationUpdate();
          })
          .catch(() => {});
      }
      if (typeof window !== "undefined") {
        window.addEventListener("resize", () => {
          this.scheduleHomeTruncationUpdate();
        });
      }
    }
  };
}
