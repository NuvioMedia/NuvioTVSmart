import { Router } from "../../navigation/routerState.js";

import { ScreenUtils } from "../../navigation/screen.js";

import { streamRepository } from "../../../data/repository/streamRepository.js";

import { addonRepository } from "../../../data/repository/addonRepository.js";

import { watchProgressRepository } from "../../../data/repository/watchProgressRepository.js";

import { isWatchProgressInProgress } from "../../../domain/model/watchProgress.js";

import { PlayerSettingsStore } from "../../../data/local/playerSettingsStore.js";

import { StreamPreferencesStore } from "../../../data/local/streamPreferencesStore.js";

import { PluginManager } from "../../../core/player/pluginManager.js";

import { PLUGIN_REPOSITORY_TYPES, isExecutableScraper, pluginSupportsType } from "../../../core/player/pluginModels.js";

import { selectAutoPlayStream, isAutoPlayEffectivelyEnabled } from "../../../core/streams/streamAutoPlaySelector.js";

import { orderSourceNames, orderStreamsByAddonOrder } from "../../../core/streams/streamOrdering.js";

import { buildStreamResumeIdentity } from "../../../core/streams/streamResumeIdentity.js";

import { DirectDebridResolver } from "../../../core/debrid/directDebridResolver.js";

import { DirectDebridStreamPreparer, directDebridPreparationKey } from "../../../core/debrid/directDebridStreamPreparer.js";

import { DebridStreamPresentation } from "../../../core/debrid/directDebridStreamPresentation.js";

import { contentTextDirection } from "../../../core/util/contentTextDirection.js";

import { WebOsEngineFsResolver } from "../../../core/p2p/webosEngineFsResolver.js";

import { TizenStreamingServerResolver } from "../../../core/p2p/tizenStreamingServerResolver.js";

import { DebridSettingsStore } from "../../../data/local/debridSettingsStore.js";

import { StreamBadgeSettingsStore } from "../../../data/local/streamBadgeSettingsStore.js";

import { ensureWebOsImageProxyReady, onWebOsImageProxyReady } from "../../../core/media/imageProxy.js";

import {
  clearFailedAddonLogos,
  getCachedAddonLogoDisplayUrl,
  hasFailedAddonLogo,
  normalizeAddonLogoLookup,
  normalizeAddonLogoUrl,
  preloadAddonLogoImages,
  preloadAddonLogoUrls,
  rememberAddonLogoLookup,
  rememberFailedAddonLogo,
  requestAddonLogo,
  resolveAddonLogo
} from "../../../core/media/addonLogoCache.js";

import { Environment } from "../../../platform/environment.js";

import { getTvRuntimePerformanceProfile } from "../../../platform/tvRuntimePerformance.js";

import { WebOsLunaService } from "../../../platform/webos/webosLunaService.js";

import { I18n } from "../../../i18n/index.js";

import { localizedGenreText } from "../../../i18n/genreLabels.js";

import { matchStreamBadges, normalizeStreamBadgeChipColor, normalizeStreamBadgeRules } from "../../../core/streams/streamBadgeRules.js";

import { normalizeMathematicalAlphanumericSymbols } from "../../../core/streams/streamDisplayText.js";

import { renderLoadingIndicator } from "../../components/loadingIndicator.js";

import {
  buildStreamVirtualModel,
  findStreamVirtualIndex,
  getStreamScrollTopForIndex,
  getStreamVirtualWindow,
  STREAM_VIRTUALIZATION_DEFAULT_ROW_EXTENT,
  STREAM_VIRTUALIZATION_MIN_WINDOW,
  STREAM_VIRTUALIZATION_OVERSCAN_PX,
  STREAM_VIRTUALIZATION_THRESHOLD
} from "./streamVirtualizer.js";

import { isStreamEmptyStateVisible } from "./streamEmptyState.js";

export const STREAM_BADGE_LIMIT = 9;

export const STREAM_DPAD_REPEAT_THROTTLE_MS = 112;

export const STREAM_BADGE_WINDOW_ROWS = 24;

export const WEBOS_NATIVE_PLAYER_APP_IDS = ["com.webos.app.mediadiscovery", "com.webos.app.photovideo", "com.webos.app.smartshare"];

export const WEBOS_DLNA_PROTOCOL_SUFFIX = "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000";

export function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function isPerformanceConstrainedRuntime() {
  return Boolean(
    getTvRuntimePerformanceProfile().isPerformanceConstrained || globalThis.document?.body?.classList?.contains("performance-constrained")
  );
}

export function escapeHtml(value = "") {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function isLaunchableExternalMediaUrl(value = "") {
  try {
    const parsed = new URL(String(value || "").trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "file:";
  } catch (_) {
    return false;
  }
}

export function isLocalOnlyPlaybackUrl(value = "") {
  try {
    const parsed = new URL(String(value || "").trim());
    if (parsed.protocol === "file:") {
      return false;
    }
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1";
  } catch (_) {
    return false;
  }
}

export function buildWebOsDlnaProtocolInfo(mimeType = "video/mp4") {
  const normalized = String(mimeType || "video/mp4").trim() || "video/mp4";
  return `http-get:*:${normalized}:${WEBOS_DLNA_PROTOCOL_SUFFIX}`;
}

export function normalizeExternalLaunchFileName(value = "") {
  const trimmed = String(value || "").trim();
  return (
    trimmed
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "Nuvio"
  );
}

export function guessMimeTypeFromUrl(url = "") {
  const value = String(url || "")
    .trim()
    .toLowerCase();
  if (!value) {
    return null;
  }
  const extensionMatch = value.match(/\.(m3u8|mpd|mp4|m4v|mov|mkv|webm|ts|m2ts|mp3|aac|flac)(?=($|[/?#&]))/i);
  if (!extensionMatch) {
    return null;
  }
  const extension = String(extensionMatch[1] || "").toLowerCase();
  const mimeMap = {
    aac: "audio/aac",
    flac: "audio/flac",
    m2ts: "video/mp2t",
    m3u8: "application/vnd.apple.mpegurl",
    m4v: "video/mp4",
    mkv: "video/x-matroska",
    mov: "video/quicktime",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    mpd: "application/dash+xml",
    ts: "video/mp2t",
    webm: "video/webm"
  };
  return mimeMap[extension] || null;
}

export function getDpadDirection(event) {
  const keyCode = Number(event?.keyCode || 0);
  const key = String(event?.key || "").toLowerCase();
  if (keyCode === 37 || key === "arrowleft" || key === "left") return "left";
  if (keyCode === 39 || key === "arrowright" || key === "right") return "right";
  if (keyCode === 38 || key === "arrowup" || key === "up") return "up";
  if (keyCode === 40 || key === "arrowdown" || key === "down") return "down";
  return null;
}

export function isBackEvent(event) {
  return Environment.isBackEvent(event);
}

export function normalizeType(itemType) {
  const normalized = String(itemType || "movie").toLowerCase();
  return normalized || "movie";
}

export function detectQuality(text = "") {
  const value = String(text).toLowerCase();
  if (value.includes("2160") || value.includes("4k")) return "4k";
  if (value.includes("1080")) return "1080p";
  if (value.includes("720")) return "720p";
  if (value.includes("480")) return "480p";
  return "Auto";
}

export function isMagnetUrl(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .startsWith("magnet:");
}

export function streamDebridIdentity(item = {}) {
  const resolve = item.clientResolve || item.raw?.clientResolve || {};
  const behaviorHints = item.behaviorHints || item.raw?.behaviorHints || {};
  const infoHash = item.infoHash || item.raw?.infoHash || resolve.infoHash || "";
  const magnetUri = resolve.magnetUri || (isMagnetUrl(item.url) ? item.url : "") || (isMagnetUrl(item.externalUrl) ? item.externalUrl : "");
  const hasDebridMarker = Boolean(
    item.clientResolve || item.raw?.clientResolve || item.debridCacheStatus || item.raw?.debridCacheStatus || infoHash || magnetUri
  );
  if (!hasDebridMarker) {
    return "";
  }
  const locator = infoHash || magnetUri || item.url || item.externalUrl || item.ytId || "";
  if (!locator) {
    return "";
  }
  return [
    String(item.addonName || "Addon"),
    String(resolve.service || item.debridCacheStatus?.providerId || item.raw?.debridCacheStatus?.providerId || ""),
    String(locator),
    String(resolve.fileIdx ?? item.fileIdx ?? item.raw?.fileIdx ?? ""),
    String(behaviorHints.filename || resolve.filename || ""),
    String(resolve.torrentName || "")
  ].join("::");
}

export function streamMergeKey(item = {}) {
  const debridIdentity = streamDebridIdentity(item);
  if (debridIdentity) {
    return `debrid::${debridIdentity}`;
  }
  // A media server stream carries no url. It is resolved at play time from the
  // connection, so identify it by what it is resolved from.
  const mediaServer = (item.clientResolve || item.raw?.clientResolve)?.mediaServer;
  if (mediaServer) {
    return `server::${mediaServer.connectionId}::${mediaServer.itemId}::${mediaServer.mediaSourceId}`;
  }
  const locator = item.url || item.externalUrl || item.ytId || "";
  if (!locator) {
    return "";
  }
  return [
    String(item.addonName || "Addon"),
    String(locator),
    String(item.sourceType || ""),
    String(item.fileIdx ?? ""),
    String(item.behaviorHints?.filename || "")
  ].join("::");
}

export function mergeStreamItem(previous = {}, next = {}) {
  const behaviorHints = {
    ...(previous.behaviorHints || {}),
    ...(next.behaviorHints || {})
  };
  return {
    ...previous,
    ...next,
    id: previous.id || next.id,
    url: next.url || previous.url || null,
    externalUrl: next.externalUrl || previous.externalUrl || null,
    ytId: next.ytId || previous.ytId || null,
    behaviorHints: Object.keys(behaviorHints).length ? behaviorHints : null,
    subtitles: Array.isArray(next.subtitles) && next.subtitles.length ? next.subtitles : previous.subtitles,
    sources: Array.isArray(next.sources) && next.sources.length ? next.sources : previous.sources,
    streamPresentation: next.streamPresentation || previous.streamPresentation || null
  };
}

export function formatBytes(value) {
  const size = Number(value || 0);
  if (!Number.isFinite(size) || size <= 0) {
    return "";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = size;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex >= 3 ? 2 : unitIndex >= 2 ? 1 : 0;
  return `${amount.toFixed(precision)} ${units[unitIndex]}`;
}

export function normalizeEpisodeCode(season, episode) {
  const seasonNumber = Number(season);
  const episodeNumber = Number(episode || 0);
  if (season == null || !Number.isFinite(seasonNumber) || seasonNumber < 0 || episodeNumber <= 0) {
    return "";
  }
  return `S${seasonNumber} E${episodeNumber}`;
}
