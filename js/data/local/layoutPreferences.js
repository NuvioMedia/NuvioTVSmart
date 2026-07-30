import { createProfileScopedStore } from "./profileScopedStore.js";

const KEY = "layoutPreferences";

const DEFAULTS = {
  homeLayout: "modern",
  heroSectionEnabled: true,
  searchDiscoverEnabled: true,
  posterLabelsEnabled: true,
  catalogAddonNameEnabled: true,
  catalogTypeSuffixEnabled: true,
  modernLandscapePostersEnabled: false,
  modernHeroFullScreenBackdropEnabled: false,
  focusedPosterBackdropExpandEnabled: false,
  focusedPosterBackdropExpandDelaySeconds: 3,
  focusedPosterBackdropTrailerEnabled: false,
  focusedPosterBackdropTrailerMuted: true,
  focusedPosterBackdropTrailerPlaybackTarget: "hero_media",
  posterCardWidthDp: 126,
  posterCardCornerRadiusDp: 12,
  detailPageTrailerButtonEnabled: true,
  blurUnwatchedEpisodes: false,
  collapseSidebar: false,
  modernSidebar: false,
  modernSidebarBlur: false,
  hideUnreleasedContent: false,
  useEpisodeThumbnailsInCw: true,
  blurContinueWatchingNextUp: false,
  showUnairedNextUp: true,
  nextUpFromFurthestEpisode: true,
  continueWatchingSortMode: "default"
};

function normalizeContinueWatchingSortMode(value) {
  const normalized = String(value || "default")
    .trim()
    .toLowerCase();
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

  return {
    ...merged,
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
    detailPageTrailerButtonEnabled: Boolean(merged.detailPageTrailerButtonEnabled),
    blurUnwatchedEpisodes: Boolean(merged.blurUnwatchedEpisodes),
    useEpisodeThumbnailsInCw: merged.useEpisodeThumbnailsInCw !== false,
    blurContinueWatchingNextUp: Boolean(merged.blurContinueWatchingNextUp),
    showUnairedNextUp: merged.showUnairedNextUp !== false,
    nextUpFromFurthestEpisode: merged.nextUpFromFurthestEpisode !== false,
    continueWatchingSortMode: normalizeContinueWatchingSortMode(merged.continueWatchingSortMode),
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

export const LayoutPreferences = {
  getForProfile(profileId) {
    return store.getForProfile(profileId);
  },

  get() {
    return store.get();
  },

  replaceForProfile(profileId, nextValue, options = {}) {
    return store.replaceForProfile(profileId, nextValue, options);
  },

  setForProfile(profileId, partial, options = {}) {
    return store.setForProfile(profileId, partial, options);
  },

  set(partial, options = {}) {
    return store.set(partial, options);
  }
};
