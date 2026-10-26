import { normalizeOpenSubtitlesSpanishCode } from "../player/subtitleLanguageAliases.js";
import { DebridSettingsStore } from "../../data/local/debridSettingsStore.js";

import { DebridProviders } from "./debridProviders.js";

import { DebridStreamTemplateEngine } from "./debridStreamTemplateEngine.js";

import { sizeBytesFromStreamText } from "./streamTextSizeParser.js";

import { resolutionFromFields } from "./streamResolution.js";

import { LANGUAGE_LABELS, searchText, qualityFromText } from "./debridStreamPresentationHelpers-01-resolution-labels.js";

export function hasToken(text = "", token = "") {
  return new RegExp(
    `(^|[^a-z0-9])${String(token || "")
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .toLowerCase()}([^a-z0-9]|$)`,
    "i"
  ).test(String(text || ""));
}

export function isDolbyVisionToken(value = "") {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return normalized === "dv" || normalized === "dovi" || normalized === "dolbyvision";
}

export function isHdrToken(value = "") {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9+]/g, "");
  return normalized === "hdr" || normalized === "hdr10" || normalized === "hdr10+" || normalized === "hdr10plus" || normalized === "hlg";
}

export function visualTagsFromText(parsedHdr = [], search = "") {
  const parsed = Array.isArray(parsedHdr) ? parsedHdr : [];
  const text = [...parsed, search].join(" ").toLowerCase();
  const tags = [];
  const hasDv = parsed.some(isDolbyVisionToken) || /(^|[^a-z0-9])(dv|dovi|dolby[ ._-]?vision)([^a-z0-9]|$)/i.test(search);
  const hasHdr = parsed.some(isHdrToken) || /(^|[^a-z0-9])(hdr|hdr10|hdr10plus|hdr10\+|hlg)([^a-z0-9]|$)/i.test(search);
  if (hasDv && hasHdr) tags.push("HDR_DV");
  if (hasDv && !hasHdr) tags.push("DV_ONLY");
  if (hasHdr && !hasDv) tags.push("HDR_ONLY");
  if (text.includes("hdr10+") || text.includes("hdr10plus")) tags.push("HDR10_PLUS");
  if (text.includes("hdr10")) tags.push("HDR10");
  if (hasDv) tags.push("DV");
  if (hasHdr) tags.push("HDR");
  if (hasToken(text, "hlg")) tags.push("HLG");
  if (text.includes("10bit") || text.includes("10 bit")) tags.push("TEN_BIT");
  if (hasToken(text, "3d")) tags.push("THREE_D");
  if (hasToken(text, "imax")) tags.push("IMAX");
  if (hasToken(text, "ai")) tags.push("AI");
  if (hasToken(text, "sdr")) tags.push("SDR");
  if (text.includes("h-ou")) tags.push("H_OU");
  if (text.includes("h-sbs")) tags.push("H_SBS");
  return Array.from(new Set(tags)).length ? Array.from(new Set(tags)) : ["UNKNOWN"];
}

export function audioTagsFromText(parsedAudio = [], search = "") {
  const text = [...(Array.isArray(parsedAudio) ? parsedAudio : []), search].join(" ").toLowerCase();
  const tags = [];
  if (hasToken(text, "atmos")) tags.push("ATMOS");
  if (text.includes("dd+") || text.includes("ddp") || text.includes("dolby digital plus")) tags.push("DD_PLUS");
  if (hasToken(text, "dd") || text.includes("ac3") || text.includes("dolby digital")) tags.push("DD");
  if (text.includes("dts:x") || text.includes("dtsx")) tags.push("DTS_X");
  if (text.includes("dts-hd ma") || text.includes("dtshd ma")) tags.push("DTS_HD_MA");
  if (text.includes("dts-hd") || text.includes("dtshd")) tags.push("DTS_HD");
  if (text.includes("dts-es") || text.includes("dtses")) tags.push("DTS_ES");
  if (hasToken(text, "dts")) tags.push("DTS");
  if (text.includes("truehd") || text.includes("true hd")) tags.push("TRUEHD");
  if (hasToken(text, "opus")) tags.push("OPUS");
  if (hasToken(text, "flac")) tags.push("FLAC");
  if (hasToken(text, "aac")) tags.push("AAC");
  return Array.from(new Set(tags)).length ? Array.from(new Set(tags)) : ["UNKNOWN"];
}

export function audioChannelsFromText(parsedChannels = [], search = "") {
  const text = [...(Array.isArray(parsedChannels) ? parsedChannels : []), search].join(" ").toLowerCase();
  const channels = [];
  if (hasToken(text, "7.1")) channels.push("CH_7_1");
  if (hasToken(text, "6.1")) channels.push("CH_6_1");
  if (hasToken(text, "5.1") || hasToken(text, "6ch")) channels.push("CH_5_1");
  if (hasToken(text, "2.0")) channels.push("CH_2_0");
  return Array.from(new Set(channels)).length ? Array.from(new Set(channels)) : ["UNKNOWN"];
}

export function encodeFromText(parsedCodec, search = "") {
  const text = [parsedCodec, search].filter(Boolean).join(" ").toLowerCase();
  if (hasToken(text, "av1")) return "AV1";
  if (hasToken(text, "hevc") || hasToken(text, "h265") || hasToken(text, "x265")) return "HEVC";
  if (hasToken(text, "avc") || hasToken(text, "h264") || hasToken(text, "x264")) return "AVC";
  if (hasToken(text, "xvid")) return "XVID";
  if (hasToken(text, "divx")) return "DIVX";
  return "UNKNOWN";
}

const LANGUAGE_ALIASES = {
  EN: ["eng", "english"],
  HI: ["hin", "hindi"],
  IT: ["ita", "italian", "italiano"],
  ES: ["spa", "esp", "spanish", "espanol", "castellano"],
  FR: ["fre", "french", "truefrench"],
  DE: ["ger", "deu", "german", "deutsch"],
  PT: ["portuguese", "portugues"],
  PL: ["pol", "polish"],
  CS: ["cze", "czech"],
  LA: ["latino"],
  JA: ["jpn", "japanese"],
  KO: ["kor", "korean"],
  ZH: ["chinese"],
  HE: ["heb", "hebrew"]
};
const LANGUAGE_PATTERNS = Object.entries(LANGUAGE_LABELS).map(([key, [code]]) => [
  key,
  new RegExp(`(^|[^a-z0-9])(${[code, ...(LANGUAGE_ALIASES[key] || [])].join("|")})([^a-z0-9]|$)`, "i")
]);

export function languageFor(value = "") {
  const normalized =
    normalizeOpenSubtitlesSpanishCode(value) ||
    String(value || "")
      .trim()
      .toLowerCase();
  const compact = normalized.replace(/[^a-z0-9]/g, "");
  return (
    Object.entries(LANGUAGE_LABELS).find(([key, [code, label]]) => {
      const normalizedCode = String(code || "").toLowerCase();
      const normalizedLabel = String(label || "").toLowerCase();
      return (
        normalized === normalizedCode ||
        normalized === normalizedLabel ||
        LANGUAGE_ALIASES[key]?.includes(normalized) ||
        (compact && compact === normalizedCode.replace(/[^a-z0-9]/g, ""))
      );
    })?.[0] || null
  );
}

export function languagesFromText(parsedLanguages = [], search = "") {
  const fromParsed = (Array.isArray(parsedLanguages) ? parsedLanguages : []).map(languageFor).filter(Boolean);
  if (fromParsed.length) {
    return fromParsed;
  }
  const matches = LANGUAGE_PATTERNS.filter(([, pattern]) => pattern.test(search)).map(([key]) => key);
  return matches.includes("PT_BR") ? matches.filter((key) => key !== "PT") : matches;
}

export function releaseGroupFromText(text = "") {
  return String(text || "").match(/-([a-z0-9][a-z0-9._]{1,24})($|\.)/i)?.[1] || "";
}

export function streamSize(stream = {}) {
  const resolve = stream.clientResolve || stream.raw?.clientResolve || {};
  return (
    Number(
      resolve.stream?.raw?.size ??
        stream.behaviorHints?.videoSize ??
        stream.debridCacheStatus?.cachedSize ??
        sizeBytesFromStreamText(stream) ??
        0
    ) || 0
  );
}

// Strip the first media-title occurrence in each field, keeping actual repeated language tags.
export function languageSearchText(stream = {}) {
  const resolve = stream.clientResolve || stream.raw?.clientResolve || {};
  const raw = resolve.stream?.raw || {};
  const titles = [
    ...new Set(
      [raw.parsed?.parsedTitle, resolve.title].filter(Boolean).map((title) =>
        String(title)
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter(Boolean)
          .join("[^a-z0-9]+")
      )
    )
  ]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((title) => new RegExp(`(^|[^a-z0-9])${title}(?=[^a-z0-9]|$)`));
  return [
    stream.name,
    stream.title,
    stream.description,
    stream.behaviorHints?.filename,
    resolve.torrentName,
    resolve.filename,
    raw.torrentName,
    raw.filename,
    stream.debridCacheStatus?.cachedName
  ]
    .filter(Boolean)
    .map((text) => titles.reduce((remaining, pattern) => remaining.replace(pattern, " "), String(text).toLowerCase()))
    .join(" ");
}

export function facts(stream = {}) {
  const resolve = stream.clientResolve || stream.raw?.clientResolve || {};
  const parsed = resolve.stream?.raw?.parsed || {};
  const text = searchText(stream);
  const resolution = resolutionFromFields([parsed.resolution, parsed.quality, stream.quality, text]);
  const quality = qualityFromText([parsed.quality, text].filter(Boolean).join(" "));
  const visualTags = visualTagsFromText(parsed.hdr || [], text);
  const audioTags = audioTagsFromText(parsed.audio || [], text);
  const audioChannels = audioChannelsFromText(parsed.channels || [], text);
  const languages = languagesFromText(parsed.languages || [], languageSearchText(stream));
  const codec = encodeFromText(parsed.codec, text);
  return {
    resolution,
    quality,
    size: streamSize(stream),
    hasDolbyVision: /\b(dolby.?vision|dv)\b/i.test(text),
    hasHdr: /\b(hdr10\+?|hdr|hlg)\b/i.test(text),
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
