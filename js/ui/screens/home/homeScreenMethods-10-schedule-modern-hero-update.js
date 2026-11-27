import * as internals from "./homeScreenContext.js";
import { getHeroEnrichDwellMs, isModernTvProfile } from "../../../platform/tvPerformancePolicy.js";
import { getTvRuntimePerformanceProfile } from "../../../platform/tvRuntimePerformance.js";

const MODERN_TV_HERO_ENRICH_SETTLE_DELAY_MS = 500;
const MODERN_TV_HERO_PACE_QUIET_MS = 370;
const MODERN_TV_HERO_BROWSE_WINDOW_MS = 1400;
const MODERN_TV_HERO_BROWSE_SETTLE_DELAY_MS = 520;

export function createHomeScreenMethods10() {
  const { MODERN_HOME_CONSTANTS, shouldEnrichModernHero, preloadHeroAssets, buildHeroIdentity } = internals;

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
      const tvProfile = getTvRuntimePerformanceProfile();
      let delay = immediate ? 0 : this.getHeroFocusDelay({ rapid: isRapidNav });
      if (tvProfile?.isTvRuntime && !immediate && previous > 0 && now - previous < MODERN_TV_HERO_BROWSE_WINDOW_MS) {
        delay = Math.max(delay, MODERN_TV_HERO_BROWSE_SETTLE_DELAY_MS);
      }
      this.lastModernHeroNavAt = now;
      if (isRapidNav || immediate) {
        this.container?.querySelector(".home-modern-hero-card")?.classList.add("is-hero-focus-pending");
      }
      const shouldWaitForCamera = !immediate && (deferUntilVerticalSettle || isModernTvProfile(tvProfile));
      const targetTrack = node?.closest?.(".home-track, .home-grid-track") || null;
      const isCameraScrollActive = () => {
        if (
          typeof this.isModernHydrationScrollActive === "function"
            ? Boolean(this.isModernHydrationScrollActive())
            : Boolean(this.isModernVerticalScrollActive?.())
        ) {
          return true;
        }
        return Boolean(targetTrack && this.isScrollAnimationActive?.(targetTrack, "x"));
      };
      const getInputPaceQuietRemainingMs = () => {
        if (!tvProfile?.isTvRuntime || immediate) {
          return 0;
        }
        const lastInputAt = Number(this.lastHomeInputAt || 0);
        if (!(lastInputAt > 0)) {
          return 0;
        }
        return Math.max(0, MODERN_TV_HERO_PACE_QUIET_MS - (Date.now() - lastInputAt));
      };
      const getCameraOrInputPollDelayMs = () => {
        const quietRemainingMs = getInputPaceQuietRemainingMs();
        if (shouldWaitForCamera && isCameraScrollActive()) {
          return Math.max(MODERN_HOME_CONSTANTS.verticalScrollSettlePollMs, quietRemainingMs);
        }
        return quietRemainingMs;
      };
      const waitForVerticalSettle = (callback) => {
        const pollDelayMs = getCameraOrInputPollDelayMs();
        if (pollDelayMs > 0) {
          this.heroBackdropPreloadTimer = setTimeout(() => waitForVerticalSettle(callback), pollDelayMs);
          return;
        }
        callback();
      };
      const preloadDelay =
        tvProfile?.isTvRuntime && !immediate ? Math.max(MODERN_TV_HERO_PACE_QUIET_MS, delay - 80) : Math.max(0, Math.min(120, delay - 80));
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
        const pollDelayMs = getCameraOrInputPollDelayMs();
        if (pollDelayMs > 0) {
          this.heroFocusDelayTimer = setTimeout(commitHeroWhenSettled, pollDelayMs);
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
          const activeTvProfile = getTvRuntimePerformanceProfile();
          const shouldEnrichHero = shouldEnrichModernHero(latestHero);
          // While the dwell runs the hero is a plain, complete catalog hero:
          // the enriching flag would keep the previous backdrop on screen.
          const enrichDwellMs = shouldEnrichHero ? getHeroEnrichDwellMs(activeTvProfile) : 0;
          const postCommitEnrichDelayMs =
            shouldEnrichHero && !enrichDwellMs && activeTvProfile?.isTvRuntime && !immediate ? MODERN_TV_HERO_ENRICH_SETTLE_DELAY_MS : 0;
          const effectiveEnrichDelayMs = enrichDwellMs || postCommitEnrichDelayMs;
          const focusedHero =
            shouldEnrichHero && !effectiveEnrichDelayMs
              ? { ...latestHero, heroMetaEnriching: true }
              : { ...latestHero, heroMetaEnriching: false };

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

          if (shouldEnrichHero && effectiveEnrichDelayMs > 0) {
            void preloadHeroAssets(focusedHero, "modern");
            const scheduleEnrichAfterCamera = () => {
              this.heroEnrichDwellTimer = null;
              if (Number(this.heroFocusToken || 0) !== focusToken) {
                return;
              }
              if (shouldWaitForCamera && isCameraScrollActive()) {
                this.heroEnrichDwellTimer = setTimeout(scheduleEnrichAfterCamera, MODERN_HOME_CONSTANTS.verticalScrollSettlePollMs);
                return;
              }
              void this.enrichCurrentHeroAsync(focusedHero, focusToken, { deferCommit: true });
            };
            this.heroEnrichDwellTimer = setTimeout(scheduleEnrichAfterCamera, effectiveEnrichDelayMs);
            return;
          }
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
