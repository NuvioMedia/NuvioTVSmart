import { Platform } from "./index.js";
import { TizenCapabilities } from "./tizen/tizenCapabilities.js";

// The first common TV generation with a modern Chromium baseline is Samsung
// Tizen 6.5 / Chromium M85 (2022) and LG webOS TV 22 / Chromium M87 (2022).
// Keep this policy tied to the runtime generation, not the vendor name.
export const TV_RUNTIME_PERFORMANCE_THRESHOLDS = Object.freeze({
  modernTvYear: 2022,
  modernChromiumMajor: 85
});

const WEBOS_RELEASE_YEARS = Object.freeze({
  1: 2014,
  2: 2015,
  3: 2016,
  4: 2018,
  5: 2020,
  6: 2021
});
let cachedProfile = null;

function parseVersionParts(value) {
  const match = String(value || "")
    .trim()
    .match(/^(\d+)(?:\.(\d+))?/);
  if (!match) {
    return { major: 0, minor: 0 };
  }
  return {
    major: Number(match[1] || 0),
    minor: Number(match[2] || 0)
  };
}

function readChromiumMajorVersion() {
  const userAgent = String(globalThis.navigator?.userAgent || "");
  const match = userAgent.match(/(?:chrome|chromium)\/(\d{2,3})/i);
  const version = Number(match?.[1] || 0);
  return Number.isFinite(version) ? version : 0;
}

function readWebOsMajorVersion() {
  const candidates = [
    String(globalThis.PalmSystem?.deviceInfo || ""),
    String(globalThis.webOSSystem?.deviceInfo || ""),
    String(globalThis.navigator?.userAgent || "")
  ].filter(Boolean);
  const patterns = [
    /web0s\.tv[\s\-/]?(\d{1,2})/i,
    /webos\.tv[\s\-/]?(\d{1,2})/i,
    /web0s[\s\-/]?(\d{1,2})/i,
    /webos[\s\-/]?(\d{1,2})/i
  ];
  for (const candidate of candidates) {
    for (const pattern of patterns) {
      const match = candidate.match(pattern);
      const version = Number(match?.[1] || 0);
      if (Number.isFinite(version) && version > 0) {
        return version;
      }
    }
  }
  return 0;
}

function getWebOsReleaseYear(webOsMajorVersion, chromiumMajorVersion) {
  const major = Number(webOsMajorVersion || 0);
  if (major >= 22 && major <= 99) {
    return 2000 + major;
  }
  if (WEBOS_RELEASE_YEARS[major]) {
    return WEBOS_RELEASE_YEARS[major];
  }

  const chromium = Number(chromiumMajorVersion || 0);
  if (chromium > 0) {
    if (chromium <= 38) return 2016;
    if (chromium <= 53) return 2018;
    if (chromium <= 68) return 2020;
    if (chromium <= 79) return 2021;
    if (chromium <= 87) return 2022;
    if (chromium <= 94) return 2023;
    if (chromium <= 108) return 2024;
    if (chromium <= 120) return 2025;
    return 2026;
  }
  return 0;
}

function getTizenReleaseYear(tizenVersion) {
  const { major, minor } = parseVersionParts(tizenVersion);
  if (major === 2) {
    return minor >= 4 ? 2016 : 2015;
  }
  if (major === 3) {
    return 2017;
  }
  if (major === 4) {
    return 2018;
  }
  if (major === 5) {
    return minor >= 5 ? 2020 : 2019;
  }
  if (major === 6) {
    return minor >= 5 ? 2022 : 2021;
  }
  if (major >= 7) {
    return 2016 + major;
  }
  return 0;
}

export function getTvRuntimePerformanceProfile({ forceRefresh = false } = {}) {
  if (cachedProfile && !forceRefresh) {
    return cachedProfile;
  }

  const isWebOS = Platform.isWebOS();
  const isTizen = Platform.isTizen();
  const isTvRuntime = isWebOS || isTizen;
  let chromiumMajorVersion = readChromiumMajorVersion();
  if (!isTvRuntime) {
    cachedProfile = Object.freeze({
      isTvRuntime: false,
      platform: Platform.getName(),
      tvYear: 0,
      chromiumMajorVersion,
      tvYearKnown: false,
      chromiumVersionKnown: chromiumMajorVersion > 0,
      isLegacyTvRuntime: false,
      isPerformanceConstrained: false
    });
    return cachedProfile;
  }

  let tvYear = 0;

  if (isWebOS) {
    tvYear = getWebOsReleaseYear(readWebOsMajorVersion(), chromiumMajorVersion);
  } else if (isTizen) {
    const capabilities = TizenCapabilities.get();
    tvYear = getTizenReleaseYear(capabilities?.tizenVersion);
    chromiumMajorVersion = Number(capabilities?.chromiumMajorVersion || chromiumMajorVersion);
  }

  const { modernTvYear, modernChromiumMajor } = TV_RUNTIME_PERFORMANCE_THRESHOLDS;
  const tvYearKnown = tvYear > 0;
  const chromiumVersionKnown = chromiumMajorVersion > 0;
  const isLegacyByYear = tvYearKnown && tvYear < modernTvYear;
  const isLegacyByChromium = chromiumVersionKnown && chromiumMajorVersion < modernChromiumMajor;
  const isUnidentifiedRuntime = !tvYearKnown && !chromiumVersionKnown;
  const isLegacyTvRuntime = isLegacyByYear || isLegacyByChromium || isUnidentifiedRuntime;

  cachedProfile = Object.freeze({
    isTvRuntime: true,
    platform: isWebOS ? "webos" : "tizen",
    tvYear,
    chromiumMajorVersion,
    tvYearKnown,
    chromiumVersionKnown,
    isLegacyTvRuntime,
    isPerformanceConstrained: isLegacyTvRuntime
  });
  return cachedProfile;
}

export function resetTvRuntimePerformanceProfile() {
  cachedProfile = null;
}

// Android keeps the current hero scene alive while the next artwork is being
// prepared, then crossfades the settled scene. On constrained TV runtimes
// (including unidentified ones, which fail closed to constrained) and on all
// Samsung Tizen TVs, avoid allocating a second full-screen artwork layer:
// the Web fallback still waits for the asset and fades it in, but keeps only
// one image layer alive.
export function getTvHeroTransitionMode(profile = getTvRuntimePerformanceProfile()) {
  if (profile?.isTvRuntime && profile.isPerformanceConstrained) {
    return "single-layer";
  }
  try {
    if (
      globalThis?.document?.body?.classList?.contains("legacy-tizen") ||
      globalThis?.document?.documentElement?.classList?.contains("legacy-tizen")
    ) {
      return "single-layer";
    }
  } catch (_) {}
  return "crossfade";
}
