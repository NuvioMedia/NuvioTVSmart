import * as internals from "./homeScreenContext.js";

// Tizen fast path: the hero commit waits until the D-pad has been idle for
// this long (the same window shouldDeferHomeRenderForInput uses for
// background renders), re-checking at the poll interval.
const HERO_COMMIT_INPUT_IDLE_MS = 800;
const HERO_COMMIT_INPUT_IDLE_POLL_MS = 120;

export function createHomeScreenMethods10() {
  const { MODERN_HOME_CONSTANTS, getTvRuntimePerformanceProfile, shouldEnrichModernHero, preloadHeroAssets, buildHeroIdentity } = internals;

  return {
    // On Tizen, committing the hero for every card passed at a steady browsing
    // pace costs a backdrop decode and swap, a logo swap, several innerHTML
    // rewrites and then the enrichment fetches with a second apply, all landing
    // in the window where the next press arrives. Hold the commit while the
    // D-pad is active; the hero follows focus once the user pauses (#1250).
    // The backdrop preload still runs on the normal delay, so the swap is
    // decoded ahead of time.
    isHomeInputActiveForHeroCommit() {
      try {
        const tizenFastPath =
          (typeof this.isPerformanceConstrained === "function" && this.isPerformanceConstrained()) ||
          globalThis?.document?.body?.classList?.contains("legacy-tizen") ||
          globalThis?.document?.documentElement?.classList?.contains("legacy-tizen");
        return Boolean(tizenFastPath) && Date.now() - Number(this.lastHomeInputAt || 0) < HERO_COMMIT_INPUT_IDLE_MS;
      } catch (_) {
        return false;
      }
    },
    scheduleModernHeroUpdate(node, { deferUntilVerticalSettle = false, immediate = false } = {}) {
      if (this.layoutMode !== "modern") {
        return;
      }
      const hero = this.getNodeHeroSource(node);
      if (!hero || !hero.id) {
        return;
      }
      const currentHeroIdentity = buildHeroIdentity(this.heroItem);
      const nextHeroIdentity = buildHeroIdentity(hero);
      if (currentHeroIdentity === nextHeroIdentity && !this.heroItem?.heroMetaEnriching && !shouldEnrichModernHero(hero)) {
        this.container?.querySelector(".home-modern-hero-card")?.classList.remove("is-hero-focus-pending");
        this.syncCollectionHeroMedia(hero);
        return;
      }
      this.cancelPendingHeroFocus();
      const focusToken = Number(this.heroFocusToken || 0) + 1;
      this.heroFocusToken = focusToken;
      const scheduledHeroIdentity = nextHeroIdentity;
      const now = Date.now();
      const previous = Number(this.lastModernHeroNavAt || 0);
      const isRapidNav = previous > 0 && now - previous < MODERN_HOME_CONSTANTS.heroRapidNavThresholdMs;
      const delay = immediate ? 0 : this.getHeroFocusDelay({ rapid: isRapidNav });
      this.lastModernHeroNavAt = now;
      if (isRapidNav || immediate) {
        this.container?.querySelector(".home-modern-hero-card")?.classList.add("is-hero-focus-pending");
      }
      const canPreloadHeroDuringVerticalScroll =
        deferUntilVerticalSettle && getTvRuntimePerformanceProfile().isTvRuntime && !this.isPerformanceConstrained();
      const waitForVerticalSettle = (callback) => {
        if (deferUntilVerticalSettle && !canPreloadHeroDuringVerticalScroll && this.isModernVerticalScrollActive()) {
          this.heroBackdropPreloadTimer = setTimeout(
            () => waitForVerticalSettle(callback),
            MODERN_HOME_CONSTANTS.verticalScrollSettlePollMs
          );
          return;
        }
        callback();
      };
      const preloadDelay = Math.max(0, Math.min(120, delay - 80));
      this.heroBackdropPreloadTimer = setTimeout(() => {
        this.heroBackdropPreloadTimer = null;
        waitForVerticalSettle(() => {
          if (Number(this.heroFocusToken || 0) !== focusToken) {
            return;
          }
          const focusedNode = this.getCurrentFocusedNode();
          if (focusedNode !== node || !node?.isConnected || !node.classList.contains("focused")) {
            return;
          }
          const focusedHero = this.getNodeHeroSource(node);
          if (buildHeroIdentity(focusedHero) !== scheduledHeroIdentity) {
            return;
          }
          void preloadHeroAssets(focusedHero, "modern");
        });
      }, preloadDelay);
      const commitHeroWhenSettled = () => {
        if (deferUntilVerticalSettle && this.isModernVerticalScrollActive()) {
          this.heroFocusDelayTimer = setTimeout(commitHeroWhenSettled, MODERN_HOME_CONSTANTS.verticalScrollSettlePollMs);
          return;
        }
        if (!immediate && this.isHomeInputActiveForHeroCommit()) {
          this.heroFocusDelayTimer = setTimeout(commitHeroWhenSettled, HERO_COMMIT_INPUT_IDLE_POLL_MS);
          return;
        }
        this.heroFocusDelayTimer = null;
        if (Number(this.heroFocusToken || 0) !== focusToken) {
          return;
        }
        const currentFocusedNode = this.getCurrentFocusedNode();
        if (currentFocusedNode !== node || !node?.isConnected || !node.classList.contains("focused")) {
          return;
        }
        const currentHero = this.getNodeHeroSource(node);
        if (buildHeroIdentity(currentHero) !== scheduledHeroIdentity) {
          return;
        }
        requestAnimationFrame(() => {
          if (Number(this.heroFocusToken || 0) !== focusToken) {
            return;
          }
          const focusedNode = this.getCurrentFocusedNode();
          if (focusedNode !== node || !node?.isConnected || !node.classList.contains("focused")) {
            return;
          }
          const latestHero = this.getNodeHeroSource(node);
          if (!latestHero || buildHeroIdentity(latestHero) !== scheduledHeroIdentity) {
            return;
          }
          const shouldEnrichHero = shouldEnrichModernHero(latestHero);
          const focusedHero = shouldEnrichHero ? { ...latestHero, heroMetaEnriching: true } : { ...latestHero, heroMetaEnriching: false };

          // Android publishes the newly focused preview as soon as focus settles;
          // metadata enrichment remains an independent background update. Waiting
          // for the addon request here leaves the previous backdrop on screen for
          // several seconds on a slow TV and makes the later swap look like a
          // flicker.
          this.heroItem = focusedHero;
          const matchedIndex = this.heroCandidates.findIndex((item) => String(item?.id || "") === String(focusedHero.id || ""));
          if (matchedIndex >= 0) {
            this.heroIndex = matchedIndex;
          }
          this.applyHeroToDom();

          if (shouldEnrichHero) {
            void this.enrichCurrentHeroAsync(focusedHero, focusToken, { deferCommit: true });
            return;
          }

          // Each media layer starts/reuses its own guarded preload before
          // swapping, matching Android's independent AsyncImage loading path.
          void preloadHeroAssets(focusedHero, "modern");
          if (Number(this.heroFocusToken || 0) !== focusToken) {
            return;
          }
          const settledFocusedNode = this.getCurrentFocusedNode();
          if (settledFocusedNode !== node || !node?.isConnected || !node.classList.contains("focused")) {
            return;
          }
          const settledHero = this.getNodeHeroSource(node);
          if (!settledHero || buildHeroIdentity(settledHero) !== scheduledHeroIdentity) {
            return;
          }
          if (buildHeroIdentity(this.heroItem) !== scheduledHeroIdentity) {
            return;
          }
        });
      };
      this.heroFocusDelayTimer = setTimeout(commitHeroWhenSettled, delay);
    }
  };
}
