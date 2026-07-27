import { DebridSettingsStore } from "../../data/local/debridSettingsStore.js";
import {
  audioChannelsFromText,
  audioTagsFromText,
  buildLanguageTerms,
  encodeFromText,
  qualityFromText,
  resolutionFromText,
  tagsIn,
  visualTagsFromText
} from "../streams/releaseTags.js";
import { DebridProviders } from "./debridProviders.js";
import { DebridStreamTemplateEngine } from "./debridStreamTemplateEngine.js";

const RESOLUTION_LABELS = {
  P2160: "2160p",
  P1440: "1440p",
  P1080: "1080p",
  P720: "720p",
  P576: "576p",
  P480: "480p",
  P360: "360p"
};
const QUALITY_LABELS = {
  BLURAY_REMUX: "BluRay REMUX",
  BLURAY: "BluRay",
  WEB_DL: "WEB-DL",
  WEBRIP: "WEBRip",
  HDRIP: "HDRip",
  HD_RIP: "HC HD-Rip",
  DVDRIP: "DVDRip",
  HDTV: "HDTV",
  CAM: "CAM",
  TS: "TS",
  TC: "TC",
  SCR: "SCR"
};
const ENCODE_LABELS = { AV1: "AV1", HEVC: "HEVC", AVC: "AVC", XVID: "XviD", DIVX: "DivX" };
const VISUAL_TAG_LABELS = {
  HDR_DV: "HDR+DV",
  DV_ONLY: "DV Only",
  HDR_ONLY: "HDR Only",
  HDR10_PLUS: "HDR10+",
  HDR10: "HDR10",
  DV: "DV",
  HDR: "HDR",
  HLG: "HLG",
  TEN_BIT: "10bit",
  THREE_D: "3D",
  IMAX: "IMAX",
  AI: "AI",
  SDR: "SDR",
  H_OU: "H-OU",
  H_SBS: "H-SBS"
};
const AUDIO_TAG_LABELS = {
  ATMOS: "Atmos",
  DD_PLUS: "DD+",
  DD: "DD",
  DTS_X: "DTS:X",
  DTS_HD_MA: "DTS-HD MA",
  DTS_HD: "DTS-HD",
  DTS_ES: "DTS-ES",
  DTS: "DTS",
  TRUEHD: "TrueHD",
  OPUS: "OPUS",
  FLAC: "FLAC",
  AAC: "AAC"
};
const AUDIO_CHANNEL_LABELS = { CH_2_0: "2.0", CH_5_1: "5.1", CH_6_1: "6.1", CH_7_1: "7.1" };
const LANGUAGE_LABELS = {
  EN: ["en", "English"],
  HI: ["hi", "Hindi"],
  IT: ["it", "Italian"],
  ES: ["es", "Spanish"],
  FR: ["fr", "French"],
  DE: ["de", "German"],
  PT_BR: ["pt-br", "Brazilian Portuguese"],
  PT: ["pt", "Portuguese"],
  PL: ["pl", "Polish"],
  CS: ["cs", "Czech"],
  LA: ["la", "Latino"],
  JA: ["ja", "Japanese"],
  KO: ["ko", "Korean"],
  ZH: ["zh", "Chinese"],
  MULTI: ["multi", "Multi"]
};
const DEFAULT_RESOLUTION_ORDER = [
  "P2160",
  "P1440",
  "P1080",
  "P720",
  "P576",
  "P480",
  "P360",
  "UNKNOWN"
];
const DEFAULT_QUALITY_ORDER = [
  "BLURAY_REMUX",
  "BLURAY",
  "WEB_DL",
  "WEBRIP",
  "HDRIP",
  "HD_RIP",
  "DVDRIP",
  "HDTV",
  "CAM",
  "TS",
  "TC",
  "SCR",
  "UNKNOWN"
];
const DEFAULT_VISUAL_TAG_ORDER = [
  "HDR_DV",
  "DV_ONLY",
  "HDR_ONLY",
  "HDR10_PLUS",
  "HDR10",
  "DV",
  "HDR",
  "HLG",
  "TEN_BIT",
  "IMAX",
  "SDR",
  "THREE_D",
  "AI",
  "H_OU",
  "H_SBS",
  "UNKNOWN"
];
const DEFAULT_AUDIO_TAG_ORDER = [
  "ATMOS",
  "DD_PLUS",
  "DD",
  "DTS_X",
  "DTS_HD_MA",
  "DTS_HD",
  "DTS_ES",
  "DTS",
  "TRUEHD",
  "OPUS",
  "FLAC",
  "AAC",
  "UNKNOWN"
];
const DEFAULT_AUDIO_CHANNEL_ORDER = ["CH_7_1", "CH_6_1", "CH_5_1", "CH_2_0", "UNKNOWN"];
const DEFAULT_ENCODE_ORDER = ["AV1", "HEVC", "AVC", "XVID", "DIVX", "UNKNOWN"];
const ORIGINAL_SORT_CRITERIA = [];

function isMagnet(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .startsWith("magnet:");
}

function getStreamUrl(stream = {}) {
  return [stream.url, stream.externalUrl].find((value) => value && !isMagnet(value)) || null;
}

function isDirectDebrid(stream = {}) {
  const resolve = stream.clientResolve || stream.raw?.clientResolve;
  return Boolean(
    resolve &&
    String(resolve.type || "").toLowerCase() === "debrid" &&
    DebridProviders.isSupported(resolve.service) &&
    resolve.isCached === true
  );
}

function needsLocalDebridResolve(stream = {}) {
  return (
    !isDirectDebrid(stream) &&
    !getStreamUrl(stream) &&
    Boolean(stream.infoHash || isMagnet(stream.url) || isMagnet(stream.externalUrl))
  );
}

function isManagedDebridStream(stream = {}) {
  return (
    isDirectDebrid(stream) ||
    (needsLocalDebridResolve(stream) &&
      stream.debridCacheStatus &&
      stream.debridCacheStatus.state !== "CHECKING")
  );
}

function isUncachedDebridStream(stream = {}) {
  return needsLocalDebridResolve(stream) && stream.debridCacheStatus?.state === "NOT_CACHED";
}

function isInactiveResolverStream(stream = {}, settings = {}) {
  const providerId = DebridProviders.byId(
    stream.clientResolve?.service || stream.raw?.clientResolve?.service
  )?.id;
  const activeProviderId = DebridProviders.preferredResolverService(settings)?.provider?.id || "";
  return Boolean(
    isDirectDebrid(stream) && providerId && activeProviderId && providerId !== activeProviderId
  );
}

function searchText(stream = {}) {
  const resolve = stream.clientResolve || stream.raw?.clientResolve || {};
  const raw = resolve.stream?.raw || {};
  const parsed = raw.parsed || {};
  return [
    stream.name,
    stream.debridCacheStatus?.cachedName,
    stream.title,
    stream.description,
    stream.behaviorHints?.filename,
    stream.quality,
    resolve.filename,
    resolve.torrentName,
    raw.filename,
    raw.torrentName,
    parsed.rawTitle,
    parsed.parsedTitle,
    parsed.quality,
    parsed.resolution,
    parsed.codec,
    ...(parsed.hdr || []),
    ...(parsed.audio || []),
    ...(parsed.channels || []),
    ...(parsed.languages || [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

// Language terms reuse the shared parser: both the code ("pt-br") and the
// label ("Brazilian Portuguese") resolve to the language key.
const LANGUAGE_TERMS = buildLanguageTerms(LANGUAGE_LABELS);
const LANGUAGE_ORDER = Object.keys(LANGUAGE_LABELS);

function languagesFromText(parsedLanguages = [], search = "") {
  const parsed = Array.isArray(parsedLanguages) ? parsedLanguages : [];
  // Trust parsed languages when they name something recognisable, else scan the
  // release name.
  const fromParsed = tagsIn(parsed.join(" "), LANGUAGE_TERMS);
  const found = fromParsed.size ? fromParsed : tagsIn(search, LANGUAGE_TERMS);
  // "pt-br" also contains "pt"; the specific tag wins.
  if (found.has("PT_BR")) found.delete("PT");
  return LANGUAGE_ORDER.filter((key) => found.has(key));
}

function releaseGroupFromText(text = "") {
  return String(text || "").match(/-([a-z0-9][a-z0-9._]{1,24})($|\.)/i)?.[1] || "";
}

function streamSize(stream = {}) {
  const resolve = stream.clientResolve || stream.raw?.clientResolve || {};
  return (
    Number(
      resolve.stream?.raw?.size ??
        stream.behaviorHints?.videoSize ??
        stream.debridCacheStatus?.cachedSize ??
        0
    ) || 0
  );
}

function facts(stream = {}) {
  const resolve = stream.clientResolve || stream.raw?.clientResolve || {};
  const parsed = resolve.stream?.raw?.parsed || {};
  const text = searchText(stream);
  const resolution = resolutionFromText(
    [parsed.resolution, parsed.quality, stream.quality, text].filter(Boolean).join(" ")
  );
  const quality = qualityFromText([parsed.quality, text].filter(Boolean).join(" "));
  const visualTags = visualTagsFromText(parsed.hdr || [], text);
  const audioTags = audioTagsFromText(parsed.audio || [], text);
  const audioChannels = audioChannelsFromText(parsed.channels || [], text);
  const languages = languagesFromText(parsed.languages || [], text);
  const codec = encodeFromText(parsed.codec, text);
  return {
    resolution,
    quality,
    size: streamSize(stream),
    codec,
    visualTags,
    audioTags,
    audioChannels,
    languages,
    releaseGroup: parsed.group || releaseGroupFromText(text),
    edition:
      parsed.edition ||
      [
        parsed.extended ? "extended" : "",
        parsed.theatrical ? "theatrical" : "",
        parsed.remastered ? "remastered" : "",
        parsed.unrated ? "unrated" : ""
      ]
        .filter(Boolean)
        .join(" "),
    text
  };
}

function effectiveSettings(settings = {}) {
  const preferences =
    settings.streamPreferences && typeof settings.streamPreferences === "object"
      ? settings.streamPreferences
      : null;
  const defaultPreferences = {
    maxResults: 0,
    maxPerResolution: 0,
    maxPerQuality: 0,
    sizeMinGb: 0,
    sizeMaxGb: 0,
    preferredResolutions: DEFAULT_RESOLUTION_ORDER,
    requiredResolutions: [],
    excludedResolutions: [],
    preferredQualities: DEFAULT_QUALITY_ORDER,
    requiredQualities: [],
    excludedQualities: [],
    preferredVisualTags: DEFAULT_VISUAL_TAG_ORDER,
    requiredVisualTags: [],
    excludedVisualTags: [],
    preferredAudioTags: DEFAULT_AUDIO_TAG_ORDER,
    requiredAudioTags: [],
    excludedAudioTags: [],
    preferredAudioChannels: DEFAULT_AUDIO_CHANNEL_ORDER,
    requiredAudioChannels: [],
    excludedAudioChannels: [],
    preferredEncodes: DEFAULT_ENCODE_ORDER,
    requiredEncodes: [],
    excludedEncodes: [],
    preferredLanguages: [],
    requiredLanguages: [],
    excludedLanguages: [],
    requiredReleaseGroups: [],
    excludedReleaseGroups: [],
    sortCriteria: ORIGINAL_SORT_CRITERIA
  };
  if (preferences) {
    return {
      ...defaultPreferences,
      ...preferences,
      maxResults: Number(preferences.maxResults ?? 0) || 0,
      maxPerResolution: Number(preferences.maxPerResolution ?? 0) || 0,
      maxPerQuality: Number(preferences.maxPerQuality ?? 0) || 0,
      sizeMinGb: Number(preferences.sizeMinGb ?? 0) || 0,
      sizeMaxGb: Number(preferences.sizeMaxGb ?? 0) || 0,
      sortCriteria: Array.isArray(preferences.sortCriteria)
        ? preferences.sortCriteria
        : ORIGINAL_SORT_CRITERIA
    };
  }
  const minQuality = String(settings.streamMinimumQuality || "ANY").toUpperCase();
  const dolbyVisionFilter = String(settings.streamDolbyVisionFilter || "ANY").toUpperCase();
  const hdrFilter = String(settings.streamHdrFilter || "ANY").toUpperCase();
  const codecFilter = String(settings.streamCodecFilter || "ANY").toUpperCase();
  const sortMode = String(settings.streamSortMode || "DEFAULT").toUpperCase();
  const legacy = {
    ...defaultPreferences,
    maxResults: Number(settings.streamMaxResults ?? 0) || 0,
    requiredResolutions:
      minQuality === "P2160"
        ? ["P2160"]
        : minQuality === "P1080"
          ? ["P2160", "P1440", "P1080"]
          : minQuality === "P720"
            ? ["P2160", "P1440", "P1080", "P720"]
            : []
  };
  if (dolbyVisionFilter === "EXCLUDE") legacy.excludedVisualTags = ["DV", "DV_ONLY", "HDR_DV"];
  if (dolbyVisionFilter === "ONLY") legacy.requiredVisualTags = ["DV", "DV_ONLY", "HDR_DV"];
  if (hdrFilter === "EXCLUDE")
    legacy.excludedVisualTags = [
      ...legacy.excludedVisualTags,
      "HDR",
      "HDR10",
      "HDR10_PLUS",
      "HLG",
      "HDR_ONLY",
      "HDR_DV"
    ];
  if (hdrFilter === "ONLY")
    legacy.requiredVisualTags = [
      ...legacy.requiredVisualTags,
      "HDR",
      "HDR10",
      "HDR10_PLUS",
      "HLG",
      "HDR_ONLY",
      "HDR_DV"
    ];
  if (codecFilter === "H264") legacy.requiredEncodes = ["AVC"];
  if (codecFilter === "HEVC") legacy.requiredEncodes = ["HEVC"];
  if (codecFilter === "AV1") legacy.requiredEncodes = ["AV1"];
  if (sortMode === "QUALITY_DESC") {
    legacy.sortCriteria = [
      { key: "RESOLUTION", direction: "DESC" },
      { key: "QUALITY", direction: "DESC" },
      { key: "SIZE", direction: "DESC" }
    ];
  } else if (sortMode === "SIZE_DESC") {
    legacy.sortCriteria = [{ key: "SIZE", direction: "DESC" }];
  } else if (sortMode === "SIZE_ASC") {
    legacy.sortCriteria = [{ key: "SIZE", direction: "ASC" }];
  }
  return legacy;
}

function includesAny(values = [], required = []) {
  return (values || []).some((value) => (required || []).includes(value));
}

function equalsAnyReleaseGroup(value = "", groups = []) {
  return (groups || []).some(
    (group) =>
      String(value || "").toLowerCase() ===
      String(group || "")
        .trim()
        .toLowerCase()
  );
}

function matchesFilters(fact, preferences) {
  if (
    preferences.requiredResolutions?.length &&
    !preferences.requiredResolutions.includes(fact.resolution)
  )
    return false;
  if (preferences.excludedResolutions?.includes(fact.resolution)) return false;
  if (
    preferences.requiredQualities?.length &&
    !preferences.requiredQualities.includes(fact.quality)
  )
    return false;
  if (preferences.excludedQualities?.includes(fact.quality)) return false;
  if (
    preferences.requiredVisualTags?.length &&
    !includesAny(fact.visualTags, preferences.requiredVisualTags)
  )
    return false;
  if (includesAny(fact.visualTags, preferences.excludedVisualTags)) return false;
  if (
    preferences.requiredAudioTags?.length &&
    !includesAny(fact.audioTags, preferences.requiredAudioTags)
  )
    return false;
  if (includesAny(fact.audioTags, preferences.excludedAudioTags)) return false;
  if (
    preferences.requiredAudioChannels?.length &&
    !includesAny(fact.audioChannels, preferences.requiredAudioChannels)
  )
    return false;
  if (includesAny(fact.audioChannels, preferences.excludedAudioChannels)) return false;
  if (preferences.requiredEncodes?.length && !preferences.requiredEncodes.includes(fact.codec))
    return false;
  if (preferences.excludedEncodes?.includes(fact.codec)) return false;
  if (
    preferences.requiredLanguages?.length &&
    !includesAny(fact.languages, preferences.requiredLanguages)
  )
    return false;
  if (
    fact.languages.length &&
    fact.languages.every((language) => preferences.excludedLanguages?.includes(language))
  )
    return false;
  if (
    preferences.requiredReleaseGroups?.length &&
    !equalsAnyReleaseGroup(fact.releaseGroup, preferences.requiredReleaseGroups)
  )
    return false;
  if (equalsAnyReleaseGroup(fact.releaseGroup, preferences.excludedReleaseGroups)) return false;
  if (preferences.sizeMinGb > 0 && fact.size && fact.size < preferences.sizeMinGb * 1000000000)
    return false;
  if (preferences.sizeMaxGb > 0 && fact.size && fact.size > preferences.sizeMaxGb * 1000000000)
    return false;
  return true;
}

function rank(value, preferred = []) {
  const index = (preferred || []).indexOf(value);
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

function rankAny(values = [], preferred = []) {
  return (values || []).reduce(
    (best, value) => Math.min(best, rank(value, preferred)),
    Number.MAX_SAFE_INTEGER
  );
}

function compareKey(leftFact, rightFact, criterion = {}, preferences = {}) {
  const direction = criterion.direction === "ASC" ? 1 : -1;
  switch (criterion.key) {
    case "RESOLUTION":
      return (
        (rank(leftFact.resolution, preferences.preferredResolutions) -
          rank(rightFact.resolution, preferences.preferredResolutions)) *
        -direction
      );
    case "QUALITY":
      return (
        (rank(leftFact.quality, preferences.preferredQualities) -
          rank(rightFact.quality, preferences.preferredQualities)) *
        -direction
      );
    case "VISUAL_TAG":
      return (
        (rankAny(leftFact.visualTags, preferences.preferredVisualTags) -
          rankAny(rightFact.visualTags, preferences.preferredVisualTags)) *
        -direction
      );
    case "AUDIO_TAG":
      return (
        (rankAny(leftFact.audioTags, preferences.preferredAudioTags) -
          rankAny(rightFact.audioTags, preferences.preferredAudioTags)) *
        -direction
      );
    case "AUDIO_CHANNEL":
      return (
        (rankAny(leftFact.audioChannels, preferences.preferredAudioChannels) -
          rankAny(rightFact.audioChannels, preferences.preferredAudioChannels)) *
        -direction
      );
    case "ENCODE":
      return (
        (rank(leftFact.codec, preferences.preferredEncodes) -
          rank(rightFact.codec, preferences.preferredEncodes)) *
        -direction
      );
    case "SIZE":
      return ((leftFact.size || 0) - (rightFact.size || 0)) * direction;
    case "LANGUAGE":
      return (
        (rankAny(leftFact.languages, preferences.preferredLanguages) -
          rankAny(rightFact.languages, preferences.preferredLanguages)) *
        -direction
      );
    case "RELEASE_GROUP":
      return String(leftFact.releaseGroup || "").localeCompare(
        String(rightFact.releaseGroup || "")
      );
    default:
      return 0;
  }
}

function compareStreams(left, right, preferences) {
  const criteria =
    Array.isArray(preferences.sortCriteria) && preferences.sortCriteria.length
      ? preferences.sortCriteria
      : ORIGINAL_SORT_CRITERIA;
  for (const criterion of criteria) {
    const comparison = compareKey(left.fact, right.fact, criterion, preferences);
    if (comparison !== 0) {
      return comparison;
    }
  }
  return 0;
}

function applyLimits(entries = [], preferences = {}) {
  const resolutionCounts = new Map();
  const qualityCounts = new Map();
  const result = [];
  for (const entry of entries) {
    if (preferences.maxResults > 0 && result.length >= preferences.maxResults) break;
    if (
      preferences.maxPerResolution > 0 &&
      (resolutionCounts.get(entry.fact.resolution) || 0) >= preferences.maxPerResolution
    )
      continue;
    if (
      preferences.maxPerQuality > 0 &&
      (qualityCounts.get(entry.fact.quality) || 0) >= preferences.maxPerQuality
    )
      continue;
    resolutionCounts.set(
      entry.fact.resolution,
      (resolutionCounts.get(entry.fact.resolution) || 0) + 1
    );
    qualityCounts.set(entry.fact.quality, (qualityCounts.get(entry.fact.quality) || 0) + 1);
    result.push(entry);
  }
  return result;
}

function labelUnlessUnknown(value, labels) {
  return value && value !== "UNKNOWN" ? labels[value] || value : null;
}

function labelsExcludingUnknown(values = [], labels = {}) {
  return (values || [])
    .filter((value) => value !== "UNKNOWN")
    .map((value) => labels[value] || value)
    .filter(Boolean);
}

function toArray(value) {
  return Array.isArray(value) ? value.filter((entry) => entry != null && String(entry).trim()) : [];
}

function twoDigits(value) {
  return String(Math.trunc(Number(value || 0))).padStart(2, "0");
}

function buildSeasonEpisodeList(season, episode, seasons = [], episodes = []) {
  if (season != null && episode != null) {
    return [`S${twoDigits(season)}E${twoDigits(episode)}`];
  }
  if (!seasons.length || !episodes.length) {
    return [];
  }
  return seasons.flatMap((seasonEntry) =>
    episodes.map((episodeEntry) => `S${twoDigits(seasonEntry)}E${twoDigits(episodeEntry)}`)
  );
}

function formatEpisodes(episodes = []) {
  return episodes.map((episode) => `E${twoDigits(episode)}`).join(" • ");
}

function formatSeasons(seasons = []) {
  return seasons.map((season) => `S${twoDigits(season)}`).join(" • ");
}

function languageEmoji(language = "") {
  switch (String(language || "").toLowerCase()) {
    case "en":
    case "eng":
    case "english":
      return "🇬🇧";
    case "hi":
    case "hin":
    case "hindi":
    case "ml":
    case "mal":
    case "malayalam":
    case "ta":
    case "tam":
    case "tamil":
    case "te":
    case "tel":
    case "telugu":
      return "🇮🇳";
    case "ja":
    case "jpn":
    case "japanese":
      return "🇯🇵";
    case "ko":
    case "kor":
    case "korean":
      return "🇰🇷";
    case "fr":
    case "fre":
    case "fra":
    case "french":
      return "🇫🇷";
    case "es":
    case "spa":
    case "spanish":
      return "🇪🇸";
    case "de":
    case "ger":
    case "deu":
    case "german":
      return "🇩🇪";
    case "it":
    case "ita":
    case "italian":
      return "🇮🇹";
    case "pt-br":
    case "ptbr":
    case "br":
    case "brazilian portuguese":
    case "portuguese brazilian":
      return "🇧🇷";
    case "pt":
    case "por":
    case "portuguese":
      return "🇵🇹";
    case "multi":
      return "Multi";
    default:
      return language;
  }
}

function streamType(stream = {}, resolve = {}) {
  if (stream.debridCacheStatus) return "Debrid";
  if (String(resolve.type || "").toLowerCase() === "debrid") return "Debrid";
  if (String(resolve.type || "").toLowerCase() === "torrent") return "p2p";
  return resolve.type || "";
}

function serviceCached(stream = {}, resolve = {}) {
  switch (stream.debridCacheStatus?.state) {
    case "CACHED":
      return true;
    case "NOT_CACHED":
      return false;
    default:
      return typeof resolve.isCached === "boolean" ? resolve.isCached : null;
  }
}

function buildTemplateValues(stream = {}, fact = {}) {
  const resolve = stream.clientResolve || stream.raw?.clientResolve || {};
  const raw = resolve.stream?.raw || {};
  const parsed = raw.parsed || {};
  const seasons = toArray(parsed.seasons);
  const episodes = toArray(parsed.episodes);
  const visualTags = [...toArray(parsed.hdr), parsed.bitDepth].filter(Boolean);
  const audioTags = toArray(parsed.audio);
  const audioChannels = toArray(parsed.channels);
  const languages = toArray(parsed.languages);
  const providerId = stream.debridCacheStatus?.providerId || resolve.service;
  const provider = DebridProviders.byId(providerId);
  const serviceShortName =
    String(resolve.serviceExtension || "").trim() || provider?.shortName || "";
  return {
    "stream.title": parsed.parsedTitle || resolve.title || stream.title || null,
    "stream.year": parsed.year ?? null,
    "stream.season": resolve.season ?? null,
    "stream.episode": resolve.episode ?? null,
    "stream.seasons": seasons,
    "stream.episodes": episodes,
    "stream.seasonEpisode": buildSeasonEpisodeList(
      resolve.season ?? null,
      resolve.episode ?? null,
      seasons,
      episodes
    ),
    "stream.formattedEpisodes": formatEpisodes(episodes),
    "stream.formattedSeasons": formatSeasons(seasons),
    "stream.resolution":
      parsed.resolution || labelUnlessUnknown(fact.resolution, RESOLUTION_LABELS),
    "stream.library": false,
    "stream.quality": parsed.quality || labelUnlessUnknown(fact.quality, QUALITY_LABELS),
    "stream.visualTags": visualTags.length
      ? visualTags
      : labelsExcludingUnknown(fact.visualTags, VISUAL_TAG_LABELS),
    "stream.audioTags": audioTags.length
      ? audioTags
      : labelsExcludingUnknown(fact.audioTags, AUDIO_TAG_LABELS),
    "stream.audioChannels": audioChannels.length
      ? audioChannels
      : labelsExcludingUnknown(fact.audioChannels, AUDIO_CHANNEL_LABELS),
    "stream.languages": languages.length
      ? languages
      : (fact.languages || []).map((language) => LANGUAGE_LABELS[language]?.[0]).filter(Boolean),
    "stream.languageEmojis": (languages.length
      ? languages
      : (fact.languages || []).map((language) => LANGUAGE_LABELS[language]?.[0]).filter(Boolean)
    ).map(languageEmoji),
    "stream.size":
      raw.size ?? stream.behaviorHints?.videoSize ?? stream.debridCacheStatus?.cachedSize ?? null,
    "stream.folderSize": raw.folderSize ?? null,
    "stream.encode": parsed.codec
      ? String(parsed.codec).toUpperCase()
      : labelUnlessUnknown(fact.codec, ENCODE_LABELS),
    "stream.indexer": raw.indexer || raw.tracker || null,
    "stream.network": parsed.network || raw.network || null,
    "stream.releaseGroup": parsed.group || fact.releaseGroup || null,
    "stream.duration": parsed.duration ?? null,
    "stream.edition": parsed.edition || fact.edition || null,
    "stream.filename":
      raw.filename ||
      resolve.filename ||
      stream.behaviorHints?.filename ||
      stream.debridCacheStatus?.cachedName ||
      null,
    "stream.regexMatched": null,
    "stream.type": streamType(stream, resolve),
    "service.cached": serviceCached(stream, resolve),
    "service.shortName": serviceShortName,
    "service.name": provider?.displayName || DebridProviders.displayName(providerId),
    "addon.name": stream.addonName || stream.raw?.addonName || null
  };
}

function formatTemplateName(value = "") {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatTemplateDescription(value = "") {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function resolveManagedStreamDescription(templateDescription = "", stream = {}, displayedName = "") {
  const displayed = String(displayedName || "").trim().toLowerCase();
  return (
    [templateDescription, stream.description, stream.title]
      .map((value) => formatTemplateDescription(value))
      .find((value) => value && value.toLowerCase() !== displayed) || null
  );
}

function formatManagedStream(stream = {}, fact, settings = DebridSettingsStore.get()) {
  const resolve = stream.clientResolve || stream.raw?.clientResolve || {};
  const providerId = stream.debridCacheStatus?.providerId || resolve.service;
  const provider = DebridProviders.byId(providerId);
  const values = buildTemplateValues(stream, fact);
  const name = formatTemplateName(
    DebridStreamTemplateEngine.render(settings.streamNameTemplate, values)
  );
  const description = formatTemplateDescription(
    DebridStreamTemplateEngine.render(settings.streamDescriptionTemplate, values)
  );
  return {
    ...stream,
    name: name || stream.name || `${DebridProviders.displayName(providerId)} Instant`,
    description: resolveManagedStreamDescription(
      description,
      stream,
      name || stream.name || `${DebridProviders.displayName(providerId)} Instant`
    ),
    addonName: stream.addonName || null,
    addonLogo: stream.addonLogo ?? null,
    debridProviderName: provider?.displayName || DebridProviders.displayName(providerId),
    streamPresentation: {
      resolution: values["stream.resolution"] || null,
      quality: values["stream.quality"] || null,
      visualTags: values["stream.visualTags"] || [],
      encode: values["stream.encode"] || null,
      audioTags: values["stream.audioTags"] || [],
      audioChannels: values["stream.audioChannels"] || [],
      languages: values["stream.languages"] || [],
      languageEmojis: values["stream.languageEmojis"] || [],
      size: values["stream.size"] || null,
      indexer: values["stream.indexer"] || null,
      releaseGroup: values["stream.releaseGroup"] || null,
      type: values["stream.type"] || null,
      cached: values["service.cached"],
      serviceShortName: values["service.shortName"] || null,
      serviceName: values["service.name"] || null
    }
  };
}

export const StreamTagParser = { languagesFromText };

export const DebridStreamPresentation = {
  apply(groups = [], settings = DebridSettingsStore.get()) {
    if (!settings.enabled || !DebridProviders.preferredResolverService(settings)) {
      return groups;
    }
    const effective = effectiveSettings(settings);
    return (groups || []).map((group) => {
      const visibleStreams = (group.streams || [])
        .filter((stream) => !isInactiveResolverStream(stream, settings))
        .filter((stream) => !isUncachedDebridStream(stream));
      const managed = visibleStreams.filter(isManagedDebridStream);
      const passthrough = visibleStreams.filter((stream) => !isManagedDebridStream(stream));
      const presented = managed
        .map((stream) => ({ stream, fact: facts(stream) }))
        .filter((entry) => matchesFilters(entry.fact, effective));
      const ordered = effective.sortCriteria.length
        ? presented.sort((left, right) => compareStreams(left, right, effective))
        : presented;
      const limited = applyLimits(ordered, effective).map((entry) =>
        formatManagedStream(entry.stream, entry.fact, settings)
      );
      return {
        ...group,
        streams: [...limited, ...passthrough]
      };
    });
  },

  sortForDisplay(streams = [], settings = DebridSettingsStore.get()) {
    if (!settings.enabled || !DebridProviders.preferredResolverService(settings)) {
      return streams;
    }
    const effective = effectiveSettings(settings);
    if (!effective.sortCriteria.length) {
      return streams;
    }
    const managed = [];
    const managedPositions = new Set();
    (streams || []).forEach((stream, index) => {
      if (!isManagedDebridStream(stream)) {
        return;
      }
      managedPositions.add(index);
      managed.push({ stream, fact: facts(stream) });
    });
    if (managed.length <= 1) {
      return streams;
    }
    managed.sort((left, right) => compareStreams(left, right, effective));
    let managedIndex = 0;
    return (streams || []).map((stream, index) => {
      if (!managedPositions.has(index)) {
        return stream;
      }
      return managed[managedIndex++]?.stream || stream;
    });
  },

  isManagedDebridStream,
  needsLocalDebridResolve
};
