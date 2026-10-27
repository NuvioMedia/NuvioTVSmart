import { DebridProviders } from "./debridProviders.js";

export const RESOLUTION_LABELS = {
  P2160: "2160p",
  P1440: "1440p",
  P1080: "1080p",
  P720: "720p",
  P576: "576p",
  P480: "480p",
  P360: "360p"
};

export const QUALITY_LABELS = {
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

export const ENCODE_LABELS = { AV1: "AV1", HEVC: "HEVC", AVC: "AVC", XVID: "XviD", DIVX: "DivX" };

export const VISUAL_TAG_LABELS = {
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

export const AUDIO_TAG_LABELS = {
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

export const AUDIO_CHANNEL_LABELS = { CH_2_0: "2.0", CH_5_1: "5.1", CH_6_1: "6.1", CH_7_1: "7.1" };

export const LANGUAGE_LABELS = {
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
  HE: ["he", "Hebrew"],
  MULTI: ["multi", "Multi"]
};

export const DEFAULT_RESOLUTION_ORDER = ["P2160", "P1440", "P1080", "P720", "P576", "P480", "P360", "UNKNOWN"];

export const DEFAULT_QUALITY_ORDER = [
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

export const DEFAULT_VISUAL_TAG_ORDER = [
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

export const DEFAULT_AUDIO_TAG_ORDER = [
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

export const DEFAULT_AUDIO_CHANNEL_ORDER = ["CH_7_1", "CH_6_1", "CH_5_1", "CH_2_0", "UNKNOWN"];

export const DEFAULT_ENCODE_ORDER = ["AV1", "HEVC", "AVC", "XVID", "DIVX", "UNKNOWN"];

export const ORIGINAL_SORT_CRITERIA = [];

export function isMagnet(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .startsWith("magnet:");
}

export function getStreamUrl(stream = {}) {
  return [stream.url, stream.externalUrl].find((value) => value && !isMagnet(value)) || null;
}

export function isDirectDebrid(stream = {}) {
  const resolve = stream.clientResolve || stream.raw?.clientResolve;
  return Boolean(
    resolve &&
    String(resolve.type || "").toLowerCase() === "debrid" &&
    DebridProviders.isSupported(resolve.service) &&
    resolve.isCached === true
  );
}

export function needsLocalDebridResolve(stream = {}) {
  return (
    !isDirectDebrid(stream) && !getStreamUrl(stream) && Boolean(stream.infoHash || isMagnet(stream.url) || isMagnet(stream.externalUrl))
  );
}

export function isManagedDebridStream(stream = {}) {
  return (
    isDirectDebrid(stream) || (needsLocalDebridResolve(stream) && stream.debridCacheStatus && stream.debridCacheStatus.state !== "CHECKING")
  );
}

export function isUncachedDebridStream(stream = {}) {
  return needsLocalDebridResolve(stream) && stream.debridCacheStatus?.state === "NOT_CACHED";
}

export function isInactiveResolverStream(stream = {}, settings = {}) {
  const providerId = DebridProviders.byId(stream.clientResolve?.service || stream.raw?.clientResolve?.service)?.id;
  const activeProviderId = DebridProviders.preferredResolverService(settings)?.provider?.id || "";
  return Boolean(isDirectDebrid(stream) && providerId && activeProviderId && providerId !== activeProviderId);
}

export function searchText(stream = {}) {
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

export function qualityFromText(text = "") {
  const value = String(text || "").toLowerCase();
  if (value.includes("remux")) return "BLURAY_REMUX";
  if (value.includes("blu-ray") || value.includes("bluray") || value.includes("bdrip") || value.includes("brrip")) return "BLURAY";
  if (value.includes("web-dl") || value.includes("webdl")) return "WEB_DL";
  if (value.includes("webrip") || value.includes("web-rip")) return "WEBRIP";
  if (value.includes("hdrip")) return "HDRIP";
  if (value.includes("hd-rip") || value.includes("hcrip")) return "HD_RIP";
  if (value.includes("dvdrip")) return "DVDRIP";
  if (value.includes("hdtv")) return "HDTV";
  if (/\bcam\b/.test(value)) return "CAM";
  if (/\bts\b/.test(value)) return "TS";
  if (/\btc\b/.test(value)) return "TC";
  if (/\bscr\b/.test(value)) return "SCR";
  return "UNKNOWN";
}
