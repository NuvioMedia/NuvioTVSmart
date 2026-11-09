// Device-tier policy for Home navigation. Modern TVs can keep artwork and the
// trailer iframe alive a little longer; constrained TV generations keep the
// aggressive release window that protects their small RAM budget.
export const HOME_TV_PERFORMANCE_POLICY = Object.freeze({
  modernArtworkEvictIdleMs: 1200,
  modernArtworkEvictMarginPx: 2600,
  legacyArtworkEvictMarginPx: 1600,
  modernTrailerCleanupDelayMs: 2400,
  legacyTrailerCleanupDelayMs: 900,
  modernTrailerMountGraceMs: 1000,
  modernArtworkCacheEntries: 640,
  legacyArtworkCacheEntries: 320,
  lowMemoryArtworkCacheEntries: 200
});

export function isModernTvProfile(profile = null) {
  return Boolean(
    profile?.isTvRuntime && !profile.isPerformanceConstrained && !profile.isLegacyTvRuntime
  );
}

export function getArtworkEvictIdleMs(profile = null) {
  return isModernTvProfile(profile) ? HOME_TV_PERFORMANCE_POLICY.modernArtworkEvictIdleMs : 0;
}

export function getArtworkEvictMarginPx(profile = null) {
  return isModernTvProfile(profile)
    ? HOME_TV_PERFORMANCE_POLICY.modernArtworkEvictMarginPx
    : HOME_TV_PERFORMANCE_POLICY.legacyArtworkEvictMarginPx;
}

export function getTrailerCleanupDelayMs(profile = null) {
  return isModernTvProfile(profile)
    ? HOME_TV_PERFORMANCE_POLICY.modernTrailerCleanupDelayMs
    : HOME_TV_PERFORMANCE_POLICY.legacyTrailerCleanupDelayMs;
}

export function getTrailerMountGraceMs(profile = null) {
  return isModernTvProfile(profile) ? HOME_TV_PERFORMANCE_POLICY.modernTrailerMountGraceMs : 0;
}

export function getArtworkCacheLimit(profile = null, deviceMemory = 0) {
  if (isModernTvProfile(profile)) {
    return HOME_TV_PERFORMANCE_POLICY.modernArtworkCacheEntries;
  }
  return Number(deviceMemory) > 0 && Number(deviceMemory) <= 1
    ? HOME_TV_PERFORMANCE_POLICY.lowMemoryArtworkCacheEntries
    : HOME_TV_PERFORMANCE_POLICY.legacyArtworkCacheEntries;
}
