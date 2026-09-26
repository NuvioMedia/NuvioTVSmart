import { createProfileScopedStore } from "./profileScopedStore.js";
import { LocalStore } from "../../core/storage/localStore.js";
import { normalizeHomeImdbRatingsVisibility } from "../../core/util/imdbRatingVisibility.js";

const KEY = "layoutPreferences";

const DEFAULTS = {
  hasChosenLayout: false,
  homeLayout: "modern",
  continueWatchingCardStyle: "card",
  heroSectionEnabled: true,
  discoverLocation: "in_search",
  heroCatalogKeys: [],
  posterLabelsEnabled: true,
  catalogAddonNameEnabled: true,
  catalogTypeSuffixEnabled: true,
  modernLandscapePostersEnabled: false,
  modernHeroFullScreenBackdropEnabled: false,
  classicFocusGradientEnabled: false,
  focusedPosterBackdropExpandEnabled: true,
  focusedPosterBackdropExpandDelaySeconds: 3,
  focusedPosterBackdropTrailerEnabled: false,
  focusedPosterBackdropTrailerMuted: true,
  focusedPosterBackdropTrailerPlaybackTarget: "hero_media",
  posterCardWidthDp: 126,
  posterCardCornerRadiusDp: 12,
  fastHorizontalNavigationEnabled: false,
  cardDepthEnabled: false,
  cardDepthEdgeStrength: 28,
  cardDepthSheenStrength: 10,
  cardDepthEdgeCoverage: 0,
  cardDepthPostersEnabled: true,
  cardDepthContinueWatchingEnabled: true,
  cardDepthEpisodeCardsEnabled: true,
  cardDepthCastEnabled: true,
  cardDepthTrailersEnabled: true,
  detailPageTrailerButtonEnabled: true,
  preferExternalMetaAddonDetail: true,
  blurUnwatchedEpisodes: false,
  collapseSidebar: false,
  modernSidebar: false,
  modernSidebarBlur: false,
  hideUnreleasedContent: false,
  showFullReleaseDate: true,
  useEpisodeThumbnailsInCw: true,
  blurContinueWatchingNextUp: false,
  continueWatchingEnabled: true,
  showUnairedNextUp: true,
  nextUpFromFurthestEpisode: true,
  continueWatchingSortMode: "default",
  homeImdbRatingsVisibility: "SHOW_ALL"
};

function normalizeContinueWatchingSortMode(value) {
  const normalized = String(value || "default")
    .trim()
    .toLowerCase();
  if (
    normalized === "split_upcoming" ||
    normalized === "split-upcoming" ||
    normalized === "splitupcoming"
  ) {
    return "split_upcoming";
  }
  return normalized === "streaming_style" ||
    normalized === "streaming-style" ||
    normalized === "streamingstyle"
    ? "streaming_style"
    : "default";
}

function normalizeLayoutPreferences(value = {}) {
  const merged = {
    ...DEFAULTS,
    ...(value || {})
  };
  const modernSidebar = Boolean(merged.modernSidebar);
  const discoverLocation = String(
    value?.discoverLocation ?? (value?.searchDiscoverEnabled === false ? "off" : "in_search")
  ).toLowerCase();
  const continueWatchingCardStyle = String(
    merged.continueWatchingCardStyle || "card"
  ).toLowerCase();

  return {
    ...merged,
    hasChosenLayout:
      typeof value?.hasChosenLayout === "boolean"
        ? value.hasChosenLayout
        : Object.keys(value || {}).length > 0,
    continueWatchingCardStyle: ["card", "wide", "poster"].includes(continueWatchingCardStyle)
      ? continueWatchingCardStyle
      : "card",
    discoverLocation: ["in_search", "in_sidebar", "off"].includes(discoverLocation)
      ? discoverLocation
      : "in_search",
    searchDiscoverEnabled: discoverLocation !== "off",
    heroCatalogKeys: [
      ...new Set(
        (Array.isArray(merged.heroCatalogKeys) ? merged.heroCatalogKeys : [])
          .map(String)
          .filter(Boolean)
      )
    ],
    modernLandscapePostersEnabled: Boolean(merged.modernLandscapePostersEnabled),
    modernHeroFullScreenBackdropEnabled: Boolean(merged.modernHeroFullScreenBackdropEnabled),
    focusedPosterBackdropExpandEnabled: Boolean(merged.focusedPosterBackdropExpandEnabled),
    focusedPosterBackdropExpandDelaySeconds: Math.max(
      0,
      Number(merged.focusedPosterBackdropExpandDelaySeconds ?? 3) || 0
    ),
    focusedPosterBackdropTrailerEnabled: Boolean(merged.focusedPosterBackdropTrailerEnabled),
    focusedPosterBackdropTrailerMuted: merged.focusedPosterBackdropTrailerMuted !== false,
    focusedPosterBackdropTrailerPlaybackTarget:
      String(merged.focusedPosterBackdropTrailerPlaybackTarget || "hero_media").toLowerCase() ===
      "expanded_card"
        ? "expanded_card"
        : "hero_media",
    posterCardWidthDp: Math.max(72, Number(merged.posterCardWidthDp ?? 126) || 126),
    posterCardCornerRadiusDp: Math.max(0, Number(merged.posterCardCornerRadiusDp ?? 12) || 12),
    fastHorizontalNavigationEnabled: Boolean(
      value?.fastHorizontalNavigationEnabled ??
      LocalStore.get("fastHorizontalNavigationEnabled", false)
    ),
    cardDepthEnabled: Boolean(merged.cardDepthEnabled),
    cardDepthEdgeStrength: Math.min(
      100,
      Math.max(0, Number(merged.cardDepthEdgeStrength ?? 28) || 0)
    ),
    cardDepthSheenStrength: Math.min(
      100,
      Math.max(0, Number(merged.cardDepthSheenStrength ?? 10) || 0)
    ),
    cardDepthEdgeCoverage: Math.min(
      100,
      Math.max(0, Number(merged.cardDepthEdgeCoverage ?? 0) || 0)
    ),
    cardDepthPostersEnabled: merged.cardDepthPostersEnabled !== false,
    cardDepthContinueWatchingEnabled: merged.cardDepthContinueWatchingEnabled !== false,
    cardDepthEpisodeCardsEnabled: merged.cardDepthEpisodeCardsEnabled !== false,
    cardDepthCastEnabled: merged.cardDepthCastEnabled !== false,
    cardDepthTrailersEnabled: merged.cardDepthTrailersEnabled !== false,
    preferExternalMetaAddonDetail: merged.preferExternalMetaAddonDetail !== false,
    showFullReleaseDate: merged.showFullReleaseDate !== false,
    detailPageTrailerButtonEnabled: Boolean(merged.detailPageTrailerButtonEnabled),
    blurUnwatchedEpisodes: Boolean(merged.blurUnwatchedEpisodes),
    useEpisodeThumbnailsInCw: merged.useEpisodeThumbnailsInCw !== false,
    blurContinueWatchingNextUp: Boolean(merged.blurContinueWatchingNextUp),
    continueWatchingEnabled: merged.continueWatchingEnabled !== false,
    showUnairedNextUp: merged.showUnairedNextUp !== false,
    nextUpFromFurthestEpisode: merged.nextUpFromFurthestEpisode !== false,
    continueWatchingSortMode: normalizeContinueWatchingSortMode(merged.continueWatchingSortMode),
    homeImdbRatingsVisibility: normalizeHomeImdbRatingsVisibility(merged.homeImdbRatingsVisibility),
    collapseSidebar: modernSidebar ? false : Boolean(merged.collapseSidebar),
    modernSidebar,
    modernSidebarBlur: modernSidebar
      ? Boolean(merged.modernSidebarBlur)
      : Boolean(merged.modernSidebarBlur)
  };
}

const store = createProfileScopedStore({
  key: KEY,
  normalize: normalizeLayoutPreferences
});

let appliedCardDepthSignature = "";

function applyCardDepthPresentation(settings) {
  const root = globalThis?.document?.documentElement;
  if (!root) return;
  // get() runs in render loops; rewriting root attributes and custom
  // properties with unchanged values still schedules document-wide style
  // invalidation on TV Chromium builds.
  const signature = [
    settings.cardDepthEnabled,
    settings.cardDepthPostersEnabled,
    settings.cardDepthContinueWatchingEnabled,
    settings.cardDepthEpisodeCardsEnabled,
    settings.cardDepthCastEnabled,
    settings.cardDepthTrailersEnabled,
    settings.cardDepthEdgeStrength,
    settings.cardDepthSheenStrength,
    settings.cardDepthEdgeCoverage
  ].join("|");
  if (signature === appliedCardDepthSignature && root.dataset.cardDepth) return;
  appliedCardDepthSignature = signature;
  root.dataset.cardDepth = settings.cardDepthEnabled ? "true" : "false";
  root.dataset.cardDepthPosters = settings.cardDepthPostersEnabled !== false ? "true" : "false";
  root.dataset.cardDepthContinueWatching =
    settings.cardDepthContinueWatchingEnabled !== false ? "true" : "false";
  root.dataset.cardDepthEpisodes =
    settings.cardDepthEpisodeCardsEnabled !== false ? "true" : "false";
  root.dataset.cardDepthCast = settings.cardDepthCastEnabled !== false ? "true" : "false";
  root.dataset.cardDepthTrailers = settings.cardDepthTrailersEnabled !== false ? "true" : "false";
  root.style.setProperty("--card-depth-edge", String(settings.cardDepthEdgeStrength / 100));
  root.style.setProperty("--card-depth-sheen", String(settings.cardDepthSheenStrength / 100));
  root.style.setProperty("--card-depth-coverage", String(settings.cardDepthEdgeCoverage / 100));
  root.style.setProperty(
    "--card-depth-coverage-size",
    `${12 + Math.round((18 * settings.cardDepthEdgeCoverage) / 100)}px`
  );
}

export const LayoutPreferences = {
  getForProfile(profileId) {
    return store.getForProfile(profileId);
  },

  get() {
    const settings = store.get();
    applyCardDepthPresentation(settings);
    return settings;
  },

  replaceForProfile(profileId, nextValue, options = {}) {
    return store.replaceForProfile(profileId, nextValue, options);
  },

  setForProfile(profileId, partial, options = {}) {
    return store.setForProfile(profileId, partial, options);
  },

  set(partial, options = {}) {
    const result = store.set(partial, options);
    applyCardDepthPresentation(store.get());
    return result;
  }
};
