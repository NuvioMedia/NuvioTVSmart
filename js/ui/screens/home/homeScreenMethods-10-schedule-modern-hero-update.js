import * as internals from "./homeScreenContext.js";

export function createHomeScreenMethods10() {
  const { MODERN_HOME_CONSTANTS, getTvRuntimePerformanceProfile, shouldEnrichModernHero, preloadHeroAssets, buildHeroIdentity } = internals;

  return {
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
