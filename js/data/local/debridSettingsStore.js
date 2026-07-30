import { createProfileScopedStore } from "./profileScopedStore.js";

const KEY = "debridSettings";
const LEGACY_STREAM_DESCRIPTION_TEMPLATE =
  '{stream.title::exists["{stream.title::title} "||""]}{stream.year::exists["({stream.year})"||""]}\n{stream.quality::exists["{stream.quality} "||""]}{stream.visualTags::exists["{stream.visualTags::join(\' | \')} "||""]}{stream.encode::exists["{stream.encode} "||""]}\n{stream.audioTags::exists["{stream.audioTags::join(\' | \')}"||""]}{stream.audioTags::exists::and::stream.audioChannels::exists[" | "||""]}{stream.audioChannels::exists["{stream.audioChannels::join(\' | \')}"||""]}\n{stream.size::>0["{stream.size::bytes} "||""]}{stream.releaseGroup::exists["{stream.releaseGroup} "||""]}{stream.indexer::exists["{stream.indexer}"||""]}\n{service.cached::istrue["Ready"||"Not Ready"]}{service.shortName::exists[" ({service.shortName})"||""]}{stream.filename::exists["\n{stream.filename}"||""]}';
export const ANDROID_DEBRID_STREAM_DESCRIPTION_TEMPLATE = LEGACY_STREAM_DESCRIPTION_TEMPLATE;

export const DEBRID_STREAM_RESOLUTIONS = [
  { id: "P2160", label: "2160p", value: 2160 },
  { id: "P1440", label: "1440p", value: 1440 },
  { id: "P1080", label: "1080p", value: 1080 },
  { id: "P720", label: "720p", value: 720 },
  { id: "P576", label: "576p", value: 576 },
  { id: "P480", label: "480p", value: 480 },
  { id: "P360", label: "360p", value: 360 },
  { id: "UNKNOWN", label: "Unknown", value: 0 }
];

export const DEBRID_STREAM_QUALITIES = [
  { id: "BLURAY_REMUX", label: "BluRay REMUX" },
  { id: "BLURAY", label: "BluRay" },
  { id: "WEB_DL", label: "WEB-DL" },
  { id: "WEBRIP", label: "WEBRip" },
  { id: "HDRIP", label: "HDRip" },
  { id: "HD_RIP", label: "HC HD-Rip" },
  { id: "DVDRIP", label: "DVDRip" },
  { id: "HDTV", label: "HDTV" },
  { id: "CAM", label: "CAM" },
  { id: "TS", label: "TS" },
  { id: "TC", label: "TC" },
  { id: "SCR", label: "SCR" },
  { id: "UNKNOWN", label: "Unknown" }
];

export const DEBRID_STREAM_VISUAL_TAGS = [
  { id: "HDR_DV", label: "HDR+DV" },
  { id: "DV_ONLY", label: "DV Only" },
  { id: "HDR_ONLY", label: "HDR Only" },
  { id: "HDR10_PLUS", label: "HDR10+" },
  { id: "HDR10", label: "HDR10" },
  { id: "DV", label: "DV" },
  { id: "HDR", label: "HDR" },
  { id: "HLG", label: "HLG" },
  { id: "TEN_BIT", label: "10bit" },
  { id: "IMAX", label: "IMAX" },
  { id: "SDR", label: "SDR" },
  { id: "THREE_D", label: "3D" },
  { id: "AI", label: "AI" },
  { id: "H_OU", label: "H-OU" },
  { id: "H_SBS", label: "H-SBS" },
  { id: "UNKNOWN", label: "Unknown" }
];

export const DEBRID_STREAM_AUDIO_TAGS = [
  { id: "ATMOS", label: "Atmos" },
  { id: "DD_PLUS", label: "DD+" },
  { id: "DD", label: "DD" },
  { id: "DTS_X", label: "DTS:X" },
  { id: "DTS_HD_MA", label: "DTS-HD MA" },
  { id: "DTS_HD", label: "DTS-HD" },
  { id: "DTS_ES", label: "DTS-ES" },
  { id: "DTS", label: "DTS" },
  { id: "TRUEHD", label: "TrueHD" },
  { id: "OPUS", label: "OPUS" },
  { id: "FLAC", label: "FLAC" },
  { id: "AAC", label: "AAC" },
  { id: "UNKNOWN", label: "Unknown" }
];

export const DEBRID_STREAM_AUDIO_CHANNELS = [
  { id: "CH_7_1", label: "7.1" },
  { id: "CH_6_1", label: "6.1" },
  { id: "CH_5_1", label: "5.1" },
  { id: "CH_2_0", label: "2.0" },
  { id: "UNKNOWN", label: "Unknown" }
];

export const DEBRID_STREAM_ENCODES = [
  { id: "AV1", label: "AV1" },
  { id: "HEVC", label: "HEVC" },
  { id: "AVC", label: "AVC" },
  { id: "XVID", label: "XviD" },
  { id: "DIVX", label: "DivX" },
  { id: "UNKNOWN", label: "Unknown" }
];

export const DEBRID_STREAM_LANGUAGES = [
  { id: "EN", code: "en", label: "English" },
  { id: "HI", code: "hi", label: "Hindi" },
  { id: "IT", code: "it", label: "Italian" },
  { id: "ES", code: "es", label: "Spanish" },
  { id: "FR", code: "fr", label: "French" },
  { id: "DE", code: "de", label: "German" },
  { id: "PT", code: "pt", label: "Portuguese" },
  { id: "PL", code: "pl", label: "Polish" },
  { id: "CS", code: "cs", label: "Czech" },
  { id: "LA", code: "la", label: "Latino" },
  { id: "JA", code: "ja", label: "Japanese" },
  { id: "KO", code: "ko", label: "Korean" },
  { id: "ZH", code: "zh", label: "Chinese" },
  { id: "MULTI", code: "multi", label: "Multi" },
  { id: "UNKNOWN", code: "unknown", label: "Unknown" }
];

export const DEBRID_STREAM_SORT_KEYS = [
  "RESOLUTION",
  "QUALITY",
  "VISUAL_TAG",
  "AUDIO_TAG",
  "AUDIO_CHANNEL",
  "ENCODE",
  "SIZE",
  "LANGUAGE",
  "RELEASE_GROUP"
];

export const DEBRID_STREAM_SORT_DIRECTIONS = ["ASC", "DESC"];

export const DEBRID_SORT_PROFILES = {
  ORIGINAL: [],
  BEST_QUALITY: [
    { key: "RESOLUTION", direction: "DESC" },
    { key: "QUALITY", direction: "DESC" },
    { key: "VISUAL_TAG", direction: "DESC" },
    { key: "AUDIO_TAG", direction: "DESC" },
    { key: "AUDIO_CHANNEL", direction: "DESC" },
    { key: "ENCODE", direction: "DESC" },
    { key: "SIZE", direction: "DESC" }
  ],
  LARGEST: [{ key: "SIZE", direction: "DESC" }],
  SMALLEST: [{ key: "SIZE", direction: "ASC" }],
  AUDIO: [
    { key: "AUDIO_TAG", direction: "DESC" },
    { key: "AUDIO_CHANNEL", direction: "DESC" },
    { key: "RESOLUTION", direction: "DESC" },
    { key: "QUALITY", direction: "DESC" },
    { key: "SIZE", direction: "DESC" }
  ],
  LANGUAGE: [
    { key: "LANGUAGE", direction: "DESC" },
    { key: "RESOLUTION", direction: "DESC" },
    { key: "QUALITY", direction: "DESC" },
    { key: "SIZE", direction: "DESC" }
  ]
};

const DEFAULT_SORT_CRITERIA = [];
const LEGACY_QUALITY_SORT = [
  { key: "RESOLUTION", direction: "DESC" },
  { key: "QUALITY", direction: "DESC" },
  { key: "SIZE", direction: "DESC" }
];
const DV_TAGS = ["DV", "DV_ONLY", "HDR_DV"];
const HDR_TAGS = ["HDR", "HDR10", "HDR10_PLUS", "HLG", "HDR_ONLY", "HDR_DV"];

export const DEFAULT_STREAM_PREFERENCES = Object.freeze({
  maxResults: 0,
  maxPerResolution: 0,
  maxPerQuality: 0,
  sizeMinGb: 0,
  sizeMaxGb: 0,
  preferredResolutions: DEBRID_STREAM_RESOLUTIONS.map((item) => item.id),
  requiredResolutions: [],
  excludedResolutions: [],
  preferredQualities: DEBRID_STREAM_QUALITIES.map((item) => item.id),
  requiredQualities: [],
  excludedQualities: [],
  preferredVisualTags: DEBRID_STREAM_VISUAL_TAGS.map((item) => item.id),
  requiredVisualTags: [],
  excludedVisualTags: [],
  preferredAudioTags: DEBRID_STREAM_AUDIO_TAGS.map((item) => item.id),
  requiredAudioTags: [],
  excludedAudioTags: [],
  preferredAudioChannels: DEBRID_STREAM_AUDIO_CHANNELS.map((item) => item.id),
  requiredAudioChannels: [],
  excludedAudioChannels: [],
  preferredEncodes: DEBRID_STREAM_ENCODES.map((item) => item.id),
  requiredEncodes: [],
  excludedEncodes: [],
  preferredLanguages: [],
  requiredLanguages: [],
  excludedLanguages: [],
  requiredReleaseGroups: [],
  excludedReleaseGroups: [],
  sortCriteria: DEFAULT_SORT_CRITERIA
});

export const DEBRID_SETTINGS_DEFAULTS = {
  enabled: false,
  cloudLibraryEnabled: true,
  torboxApiKey: "",
  premiumizeApiKey: "",
  realDebridApiKey: "",
  preferredResolverProviderId: "",
  instantPlaybackPreparationLimit: 0,
  streamMaxResults: 0,
  streamSortMode: "DEFAULT",
  streamMinimumQuality: "ANY",
  streamDolbyVisionFilter: "ANY",
  streamHdrFilter: "ANY",
  streamCodecFilter: "ANY",
  streamBadgesEnabled: true,
  streamPreferences: { ...DEFAULT_STREAM_PREFERENCES },
  streamNameTemplate:
    '{stream.resolution::=2160p["4K "||""]}{stream.resolution::=1440p["QHD "||""]}{stream.resolution::=1080p["FHD "||""]}{stream.resolution::=720p["HD "||""]}{stream.resolution::exists[""||"Direct "]}{service.shortName::exists["{service.shortName} "||"Debrid "]}Instant',
  streamDescriptionTemplate: ANDROID_DEBRID_STREAM_DESCRIPTION_TEMPLATE
};

const ENUMS = {
  streamSortMode: new Set(["DEFAULT", "QUALITY_DESC", "SIZE_DESC", "SIZE_ASC"]),
  streamMinimumQuality: new Set(["ANY", "P720", "P1080", "P2160"]),
  streamDolbyVisionFilter: new Set(["ANY", "EXCLUDE", "ONLY"]),
  streamHdrFilter: new Set(["ANY", "EXCLUDE", "ONLY"]),
  streamCodecFilter: new Set(["ANY", "H264", "HEVC", "AV1"])
};

function normalizeEnum(value, key) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return ENUMS[key]?.has(normalized) ? normalized : DEBRID_SETTINGS_DEFAULTS[key];
}

function idsFor(items) {
  return items.map((item) => item.id);
}

function normalizeStringArray(value, allowedIds = null, fallback = []) {
  const source = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const allowed = allowedIds ? new Set(allowedIds) : null;
  const normalized = [];
  source.forEach((entry) => {
    const value = String(entry || "")
      .trim()
      .toUpperCase();
    if (!value || (allowed && !allowed.has(value)) || normalized.includes(value)) {
      return;
    }
    normalized.push(value);
  });
  return normalized.length ? normalized : [...fallback];
}

function normalizeTextList(value) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\n,]/)
      : [];
  return source
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .filter((entry, index, array) => array.indexOf(entry) === index);
}

function normalizeSortCriteria(value) {
  if (!Array.isArray(value)) {
    return DEFAULT_SORT_CRITERIA;
  }
  return value
    .map((criterion) => {
      const key = String(criterion?.key || "")
        .trim()
        .toUpperCase();
      const direction = String(criterion?.direction || "DESC")
        .trim()
        .toUpperCase();
      if (!DEBRID_STREAM_SORT_KEYS.includes(key)) {
        return null;
      }
      return {
        key,
        direction: DEBRID_STREAM_SORT_DIRECTIONS.includes(direction) ? direction : "DESC"
      };
    })
    .filter(Boolean);
}

export function normalizeDebridStreamPreferences(value) {
  if (!value) {
    return { ...DEFAULT_STREAM_PREFERENCES };
  }
  let source = value;
  if (typeof value === "string") {
    try {
      source = JSON.parse(value);
    } catch {
      return { ...DEFAULT_STREAM_PREFERENCES };
    }
  }
  if (!source || typeof source !== "object") {
    return { ...DEFAULT_STREAM_PREFERENCES };
  }
  const maxResults = Math.max(0, Math.min(100, Math.trunc(Number(source.maxResults || 0))));
  const maxPerResolution = Math.max(
    0,
    Math.min(100, Math.trunc(Number(source.maxPerResolution || 0)))
  );
  const maxPerQuality = Math.max(0, Math.min(100, Math.trunc(Number(source.maxPerQuality || 0))));
  const sizeMinGb = Math.max(0, Math.min(100, Math.trunc(Number(source.sizeMinGb || 0))));
  const sizeMaxGb = Math.max(0, Math.min(100, Math.trunc(Number(source.sizeMaxGb || 0))));
  return {
    ...DEFAULT_STREAM_PREFERENCES,
    maxResults,
    maxPerResolution,
    maxPerQuality,
    sizeMinGb,
    sizeMaxGb,
    preferredResolutions: normalizeStringArray(
      source.preferredResolutions,
      idsFor(DEBRID_STREAM_RESOLUTIONS),
      DEFAULT_STREAM_PREFERENCES.preferredResolutions
    ),
    requiredResolutions: normalizeStringArray(
      source.requiredResolutions,
      idsFor(DEBRID_STREAM_RESOLUTIONS)
    ),
    excludedResolutions: normalizeStringArray(
      source.excludedResolutions,
      idsFor(DEBRID_STREAM_RESOLUTIONS)
    ),
    preferredQualities: normalizeStringArray(
      source.preferredQualities,
      idsFor(DEBRID_STREAM_QUALITIES),
      DEFAULT_STREAM_PREFERENCES.preferredQualities
    ),
    requiredQualities: normalizeStringArray(
      source.requiredQualities,
      idsFor(DEBRID_STREAM_QUALITIES)
    ),
    excludedQualities: normalizeStringArray(
      source.excludedQualities,
      idsFor(DEBRID_STREAM_QUALITIES)
    ),
    preferredVisualTags: normalizeStringArray(
      source.preferredVisualTags,
      idsFor(DEBRID_STREAM_VISUAL_TAGS),
      DEFAULT_STREAM_PREFERENCES.preferredVisualTags
    ),
    requiredVisualTags: normalizeStringArray(
      source.requiredVisualTags,
      idsFor(DEBRID_STREAM_VISUAL_TAGS)
    ),
    excludedVisualTags: normalizeStringArray(
      source.excludedVisualTags,
      idsFor(DEBRID_STREAM_VISUAL_TAGS)
    ),
    preferredAudioTags: normalizeStringArray(
      source.preferredAudioTags,
      idsFor(DEBRID_STREAM_AUDIO_TAGS),
      DEFAULT_STREAM_PREFERENCES.preferredAudioTags
    ),
    requiredAudioTags: normalizeStringArray(
      source.requiredAudioTags,
      idsFor(DEBRID_STREAM_AUDIO_TAGS)
    ),
    excludedAudioTags: normalizeStringArray(
      source.excludedAudioTags,
      idsFor(DEBRID_STREAM_AUDIO_TAGS)
    ),
    preferredAudioChannels: normalizeStringArray(
      source.preferredAudioChannels,
      idsFor(DEBRID_STREAM_AUDIO_CHANNELS),
      DEFAULT_STREAM_PREFERENCES.preferredAudioChannels
    ),
    requiredAudioChannels: normalizeStringArray(
      source.requiredAudioChannels,
      idsFor(DEBRID_STREAM_AUDIO_CHANNELS)
    ),
    excludedAudioChannels: normalizeStringArray(
      source.excludedAudioChannels,
      idsFor(DEBRID_STREAM_AUDIO_CHANNELS)
    ),
    preferredEncodes: normalizeStringArray(
      source.preferredEncodes,
      idsFor(DEBRID_STREAM_ENCODES),
      DEFAULT_STREAM_PREFERENCES.preferredEncodes
    ),
    requiredEncodes: normalizeStringArray(source.requiredEncodes, idsFor(DEBRID_STREAM_ENCODES)),
    excludedEncodes: normalizeStringArray(source.excludedEncodes, idsFor(DEBRID_STREAM_ENCODES)),
    preferredLanguages: normalizeStringArray(
      source.preferredLanguages,
      idsFor(DEBRID_STREAM_LANGUAGES)
    ),
    requiredLanguages: normalizeStringArray(
      source.requiredLanguages,
      idsFor(DEBRID_STREAM_LANGUAGES)
    ),
    excludedLanguages: normalizeStringArray(
      source.excludedLanguages,
      idsFor(DEBRID_STREAM_LANGUAGES)
    ),
    requiredReleaseGroups: normalizeTextList(source.requiredReleaseGroups),
    excludedReleaseGroups: normalizeTextList(source.excludedReleaseGroups),
    sortCriteria: normalizeSortCriteria(source.sortCriteria)
  };
}

function normalizeStreamDescriptionTemplate(value) {
  if (value == null) {
    return ANDROID_DEBRID_STREAM_DESCRIPTION_TEMPLATE;
  }
  return String(value);
}

function sameSortCriteria(left = [], right = []) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  return left.every(
    (criterion, index) =>
      criterion?.key === right[index]?.key && criterion?.direction === right[index]?.direction
  );
}

function legacyModeForSortCriteria(criteria = []) {
  if (!Array.isArray(criteria) || !criteria.length) {
    return "DEFAULT";
  }
  if (
    sameSortCriteria(criteria, DEBRID_SORT_PROFILES.BEST_QUALITY) ||
    sameSortCriteria(criteria, LEGACY_QUALITY_SORT)
  ) {
    return "QUALITY_DESC";
  }
  if (sameSortCriteria(criteria, DEBRID_SORT_PROFILES.LARGEST)) {
    return "SIZE_DESC";
  }
  if (sameSortCriteria(criteria, DEBRID_SORT_PROFILES.SMALLEST)) {
    return "SIZE_ASC";
  }
  return "DEFAULT";
}

export function sortCriteriaForLegacyMode(mode) {
  switch (String(mode || "DEFAULT").toUpperCase()) {
    case "QUALITY_DESC":
      return LEGACY_QUALITY_SORT;
    case "SIZE_DESC":
      return DEBRID_SORT_PROFILES.LARGEST;
    case "SIZE_ASC":
      return DEBRID_SORT_PROFILES.SMALLEST;
    default:
      return DEFAULT_SORT_CRITERIA;
  }
}

function resolutionsForMinimumQuality(quality) {
  const normalized = String(quality || "ANY").toUpperCase();
  const minResolution =
    normalized === "P2160" ? 2160 : normalized === "P1080" ? 1080 : normalized === "P720" ? 720 : 0;
  return DEBRID_STREAM_RESOLUTIONS.filter(
    (item) => item.value >= minResolution && item.id !== "UNKNOWN"
  ).map((item) => item.id);
}

function withoutValues(values = [], remove = []) {
  const removeSet = new Set(remove);
  return (Array.isArray(values) ? values : []).filter((value) => !removeSet.has(value));
}

function addDistinct(values = [], add = []) {
  return [...new Set([...(Array.isArray(values) ? values : []), ...add])];
}

function legacyStreamPreferences({
  maxResults = 0,
  sortMode = "DEFAULT",
  minimumQuality = "ANY",
  dolbyVisionFilter = "ANY",
  hdrFilter = "ANY",
  codecFilter = "ANY"
} = {}) {
  let preferences = normalizeDebridStreamPreferences({
    ...DEFAULT_STREAM_PREFERENCES,
    maxResults,
    sortCriteria: sortCriteriaForLegacyMode(sortMode),
    requiredResolutions: resolutionsForMinimumQuality(minimumQuality)
  });
  preferences = applyDebridFeatureFilter(preferences, "dolbyVision", dolbyVisionFilter);
  preferences = applyDebridFeatureFilter(preferences, "hdr", hdrFilter);
  preferences = applyDebridCodecFilter(preferences, codecFilter);
  return normalizeDebridStreamPreferences(preferences);
}

export function applyDebridFeatureFilter(preferences, kind, filter) {
  const tags = kind === "hdr" ? HDR_TAGS : DV_TAGS;
  const normalized = normalizeDebridStreamPreferences(preferences);
  const value = String(filter || "ANY").toUpperCase();
  if (value === "EXCLUDE") {
    return normalizeDebridStreamPreferences({
      ...normalized,
      requiredVisualTags: withoutValues(normalized.requiredVisualTags, tags),
      excludedVisualTags: addDistinct(normalized.excludedVisualTags, tags)
    });
  }
  if (value === "ONLY") {
    return normalizeDebridStreamPreferences({
      ...normalized,
      requiredVisualTags: addDistinct(normalized.requiredVisualTags, tags),
      excludedVisualTags: withoutValues(normalized.excludedVisualTags, tags)
    });
  }
  return normalizeDebridStreamPreferences({
    ...normalized,
    requiredVisualTags: withoutValues(normalized.requiredVisualTags, tags),
    excludedVisualTags: withoutValues(normalized.excludedVisualTags, tags)
  });
}

export function applyDebridCodecFilter(preferences, filter) {
  const normalized = normalizeDebridStreamPreferences(preferences);
  const value = String(filter || "ANY").toUpperCase();
  const requiredEncodes =
    value === "H264" ? ["AVC"] : value === "HEVC" ? ["HEVC"] : value === "AV1" ? ["AV1"] : [];
  return normalizeDebridStreamPreferences({
    ...normalized,
    requiredEncodes
  });
}

function normalizePreferredResolverProviderId(source) {
  const preferred = String(source.preferredResolverProviderId || "")
    .trim()
    .toLowerCase();
  const connected = [
    ["torbox", source.torboxApiKey],
    ["premiumize", source.premiumizeApiKey],
    ["realdebrid", source.realDebridApiKey]
  ]
    .filter(([id, key]) => id !== "realdebrid" && String(key || "").trim())
    .map(([id]) => id);
  return connected.includes(preferred) ? preferred : connected[0] || "";
}

function normalizeDebridSettings(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const streamPreferences = source.streamPreferences
    ? normalizeDebridStreamPreferences(source.streamPreferences)
    : legacyStreamPreferences({
        maxResults: source.streamMaxResults,
        sortMode: source.streamSortMode,
        minimumQuality: source.streamMinimumQuality,
        dolbyVisionFilter: source.streamDolbyVisionFilter,
        hdrFilter: source.streamHdrFilter,
        codecFilter: source.streamCodecFilter
      });
  return {
    ...DEBRID_SETTINGS_DEFAULTS,
    enabled: Boolean(source.enabled),
    cloudLibraryEnabled: source.cloudLibraryEnabled !== false,
    torboxApiKey: String(source.torboxApiKey || "").trim(),
    premiumizeApiKey: String(source.premiumizeApiKey || "").trim(),
    realDebridApiKey: String(source.realDebridApiKey || "").trim(),
    preferredResolverProviderId: normalizePreferredResolverProviderId(source),
    instantPlaybackPreparationLimit: Math.max(
      0,
      Math.min(5, Math.trunc(Number(source.instantPlaybackPreparationLimit || 0)))
    ),
    streamMaxResults: Math.max(
      0,
      Math.min(100, Math.trunc(Number(streamPreferences.maxResults || 0)))
    ),
    streamSortMode: legacyModeForSortCriteria(streamPreferences.sortCriteria),
    streamMinimumQuality: normalizeEnum(source.streamMinimumQuality, "streamMinimumQuality"),
    streamDolbyVisionFilter: normalizeEnum(
      source.streamDolbyVisionFilter,
      "streamDolbyVisionFilter"
    ),
    streamHdrFilter: normalizeEnum(source.streamHdrFilter, "streamHdrFilter"),
    streamCodecFilter: normalizeEnum(source.streamCodecFilter, "streamCodecFilter"),
    streamBadgesEnabled: source.streamBadgesEnabled !== false,
    streamPreferences,
    streamNameTemplate: String(
      source.streamNameTemplate || DEBRID_SETTINGS_DEFAULTS.streamNameTemplate
    ),
    streamDescriptionTemplate: normalizeStreamDescriptionTemplate(source.streamDescriptionTemplate)
  };
}

const store = createProfileScopedStore({
  key: KEY,
  normalize: normalizeDebridSettings
});

export const DebridSettingsStore = {
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
  },

  setProviderApiKey(providerId, apiKey, options = {}) {
    const normalizedProviderId = String(providerId || "")
      .trim()
      .toLowerCase();
    const field =
      normalizedProviderId === "torbox"
        ? "torboxApiKey"
        : normalizedProviderId === "premiumize"
          ? "premiumizeApiKey"
          : normalizedProviderId === "realdebrid"
            ? "realDebridApiKey"
            : "";
    if (!field) {
      return store.get();
    }
    const current = store.get();
    const partial = { [field]: String(apiKey || "").trim() };
    const next = { ...current, ...partial };
    const hasAnyVisibleKey = Boolean(next.torboxApiKey || next.premiumizeApiKey);
    if (!partial[field] && !hasAnyVisibleKey) {
      partial.enabled = false;
    }
    partial.preferredResolverProviderId = normalizePreferredResolverProviderId(next);
    return store.set(partial, options);
  },

  setStreamMaxResults(maxResults, options = {}) {
    const current = store.get();
    const normalized = Math.max(0, Math.min(100, Math.trunc(Number(maxResults || 0))));
    const streamPreferences = normalizeDebridStreamPreferences({
      ...current.streamPreferences,
      maxResults: normalized
    });
    return store.set({ streamMaxResults: normalized, streamPreferences }, options);
  },

  setStreamSortMode(mode, options = {}) {
    const normalizedMode = normalizeEnum(mode, "streamSortMode");
    const streamPreferences = normalizeDebridStreamPreferences({
      ...store.get().streamPreferences,
      sortCriteria: sortCriteriaForLegacyMode(normalizedMode)
    });
    return store.set({ streamSortMode: normalizedMode, streamPreferences }, options);
  },

  setStreamMinimumQuality(quality, options = {}) {
    const normalizedQuality = normalizeEnum(quality, "streamMinimumQuality");
    const streamPreferences = normalizeDebridStreamPreferences({
      ...store.get().streamPreferences,
      requiredResolutions: resolutionsForMinimumQuality(normalizedQuality)
    });
    return store.set({ streamMinimumQuality: normalizedQuality, streamPreferences }, options);
  },

  setStreamDolbyVisionFilter(filter, options = {}) {
    const normalizedFilter = normalizeEnum(filter, "streamDolbyVisionFilter");
    const streamPreferences = applyDebridFeatureFilter(
      store.get().streamPreferences,
      "dolbyVision",
      normalizedFilter
    );
    return store.set({ streamDolbyVisionFilter: normalizedFilter, streamPreferences }, options);
  },

  setStreamHdrFilter(filter, options = {}) {
    const normalizedFilter = normalizeEnum(filter, "streamHdrFilter");
    const streamPreferences = applyDebridFeatureFilter(
      store.get().streamPreferences,
      "hdr",
      normalizedFilter
    );
    return store.set({ streamHdrFilter: normalizedFilter, streamPreferences }, options);
  },

  setStreamCodecFilter(filter, options = {}) {
    const normalizedFilter = normalizeEnum(filter, "streamCodecFilter");
    const streamPreferences = applyDebridCodecFilter(
      store.get().streamPreferences,
      normalizedFilter
    );
    return store.set({ streamCodecFilter: normalizedFilter, streamPreferences }, options);
  },

  setStreamPreferences(preferences, options = {}) {
    const streamPreferences = normalizeDebridStreamPreferences(preferences);
    return store.set(
      {
        streamPreferences,
        streamMaxResults: streamPreferences.maxResults,
        streamSortMode: legacyModeForSortCriteria(streamPreferences.sortCriteria)
      },
      options
    );
  }
};
