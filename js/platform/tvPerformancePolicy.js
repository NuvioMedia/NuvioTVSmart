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

// RAM decides before the generation does. A 2022+ set with 1 GB still cannot
// keep the modern artwork window, the same way the native legacy client lifts
// the smallest texture budget to the lowest RAM tier first.
export function isLowMemoryDevice(deviceMemory = 0) {
  const memory = Number(deviceMemory);
  return memory > 0 && memory <= 1;
}

/** The browser's coarse RAM estimate in GB, or 0 when the API is absent. */
export function getDeviceMemoryGb() {
  return Number(globalThis?.navigator?.deviceMemory) || 0;
}

export function getArtworkEvictIdleMs(profile = null, deviceMemory = 0) {
  if (isLowMemoryDevice(deviceMemory)) return 0;
  return isModernTvProfile(profile) ? HOME_TV_PERFORMANCE_POLICY.modernArtworkEvictIdleMs : 0;
}

export function getArtworkEvictMarginPx(profile = null, deviceMemory = 0) {
  if (isLowMemoryDevice(deviceMemory)) {
    return HOME_TV_PERFORMANCE_POLICY.legacyArtworkEvictMarginPx;
  }
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
  if (isLowMemoryDevice(deviceMemory)) {
    return HOME_TV_PERFORMANCE_POLICY.lowMemoryArtworkCacheEntries;
  }
  if (isModernTvProfile(profile)) {
    return HOME_TV_PERFORMANCE_POLICY.modernArtworkCacheEntries;
  }
  return HOME_TV_PERFORMANCE_POLICY.legacyArtworkCacheEntries;
}
