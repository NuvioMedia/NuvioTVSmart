import { DebridSettingsStore } from "../../data/local/debridSettingsStore.js";

import { DebridProviders } from "./debridProviders.js";

import { DebridStreamTemplateEngine } from "./debridStreamTemplateEngine.js";

import { sizeBytesFromStreamText } from "./streamTextSizeParser.js";

import { resolutionFromFields } from "./streamResolution.js";

import { rank, rankAny } from "./debridStreamPresentationHelpers-03-effective-settings.js";
import { ORIGINAL_SORT_CRITERIA } from "./debridStreamPresentationHelpers-01-resolution-labels.js";

export function compareKey(leftFact, rightFact, criterion = {}, preferences = {}) {
  const direction = criterion.direction === "ASC" ? 1 : -1;
  switch (criterion.key) {
    case "RESOLUTION":
      return (
        (rank(leftFact.resolution, preferences.preferredResolutions) - rank(rightFact.resolution, preferences.preferredResolutions)) *
        -direction
      );
    case "QUALITY":
      return (
        (rank(leftFact.quality, preferences.preferredQualities) - rank(rightFact.quality, preferences.preferredQualities)) * -direction
      );
    case "VISUAL_TAG":
      return (
        (rankAny(leftFact.visualTags, preferences.preferredVisualTags) - rankAny(rightFact.visualTags, preferences.preferredVisualTags)) *
        -direction
      );
    case "AUDIO_TAG":
      return (
        (rankAny(leftFact.audioTags, preferences.preferredAudioTags) - rankAny(rightFact.audioTags, preferences.preferredAudioTags)) *
        -direction
      );
    case "AUDIO_CHANNEL":
      return (
        (rankAny(leftFact.audioChannels, preferences.preferredAudioChannels) -
          rankAny(rightFact.audioChannels, preferences.preferredAudioChannels)) *
        -direction
      );
    case "ENCODE":
      return (rank(leftFact.codec, preferences.preferredEncodes) - rank(rightFact.codec, preferences.preferredEncodes)) * -direction;
    case "SIZE":
      return ((leftFact.size || 0) - (rightFact.size || 0)) * direction;
    case "LANGUAGE":
      return (
        (rankAny(leftFact.languages, preferences.preferredLanguages) - rankAny(rightFact.languages, preferences.preferredLanguages)) *
        -direction
      );
    case "RELEASE_GROUP":
      return String(leftFact.releaseGroup || "").localeCompare(String(rightFact.releaseGroup || ""));
    default:
      return 0;
  }
}

export function compareStreams(left, right, preferences) {
  const criteria =
    Array.isArray(preferences.sortCriteria) && preferences.sortCriteria.length ? preferences.sortCriteria : ORIGINAL_SORT_CRITERIA;
  for (const criterion of criteria) {
    const comparison = compareKey(left.fact, right.fact, criterion, preferences);
    if (comparison !== 0) {
      return comparison;
    }
  }
  return 0;
}

export function applyLimits(entries = [], preferences = {}) {
  const resolutionCounts = new Map();
  const qualityCounts = new Map();
  const result = [];
  for (const entry of entries) {
    if (preferences.maxResults > 0 && result.length >= preferences.maxResults) break;
    if (preferences.maxPerResolution > 0 && (resolutionCounts.get(entry.fact.resolution) || 0) >= preferences.maxPerResolution) continue;
    if (preferences.maxPerQuality > 0 && (qualityCounts.get(entry.fact.quality) || 0) >= preferences.maxPerQuality) continue;
    resolutionCounts.set(entry.fact.resolution, (resolutionCounts.get(entry.fact.resolution) || 0) + 1);
    qualityCounts.set(entry.fact.quality, (qualityCounts.get(entry.fact.quality) || 0) + 1);
    result.push(entry);
  }
  return result;
}

export function labelUnlessUnknown(value, labels) {
  return value && value !== "UNKNOWN" ? labels[value] || value : null;
}

export function labelsExcludingUnknown(values = [], labels = {}) {
  return (values || [])
    .filter((value) => value !== "UNKNOWN")
    .map((value) => labels[value] || value)
    .filter(Boolean);
}

export function toArray(value) {
  return Array.isArray(value) ? value.filter((entry) => entry != null && String(entry).trim()) : [];
}

export function twoDigits(value) {
  return String(Math.trunc(Number(value || 0))).padStart(2, "0");
}

export function buildSeasonEpisodeList(season, episode, seasons = [], episodes = []) {
  if (season != null && episode != null) {
    return [`S${twoDigits(season)}E${twoDigits(episode)}`];
  }
  if (!seasons.length || !episodes.length) {
    return [];
  }
  return seasons.flatMap((seasonEntry) => episodes.map((episodeEntry) => `S${twoDigits(seasonEntry)}E${twoDigits(episodeEntry)}`));
}

export function formatEpisodes(episodes = []) {
  return episodes.map((episode) => `E${twoDigits(episode)}`).join(" • ");
}

export function formatSeasons(seasons = []) {
  return seasons.map((season) => `S${twoDigits(season)}`).join(" • ");
}

export function languageEmoji(language = "") {
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
    case "spn":
    case "esp":
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
    case "he":
    case "heb":
    case "hebrew":
      return "🇮🇱";
    case "multi":
      return "Multi";
    default:
      return language;
  }
}

export function streamType(stream = {}, resolve = {}) {
  if (stream.debridCacheStatus) return "Debrid";
  if (String(resolve.type || "").toLowerCase() === "debrid") return "Debrid";
  if (String(resolve.type || "").toLowerCase() === "torrent") return "p2p";
  return resolve.type || "";
}

export function serviceCached(stream = {}, resolve = {}) {
  switch (stream.debridCacheStatus?.state) {
    case "CACHED":
      return true;
    case "NOT_CACHED":
      return false;
    default:
      return typeof resolve.isCached === "boolean" ? resolve.isCached : null;
  }
}
