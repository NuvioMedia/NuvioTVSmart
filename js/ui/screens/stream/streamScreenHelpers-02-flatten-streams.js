import { canResolveMediaServerStream } from "../../../data/mediaserver/mediaServerRepository.js";
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

import { streamMergeKey, mergeStreamItem, STREAM_BADGE_LIMIT, detectQuality } from "./streamScreenHelpers-01-stream-badge-limit.js";

export function flattenStreams(streamResult) {
  if (!streamResult || streamResult.status !== "success") {
    return [];
  }
  const flattened = [];
  (streamResult.data || []).forEach((group) => {
    const groupName = group.addonName || "Addon";
    (group.streams || []).forEach((stream, index) => {
      const streamOrigin = {
        ...(group.streamOrigin || {}),
        ...(stream.streamOrigin || {}),
        kind:
          group.streamOrigin?.kind || stream.streamOrigin?.kind || (group.sourceProviderId || stream.sourceProviderId ? "plugin" : "addon"),
        addonId: stream.addonId || group.addonId || group.streamOrigin?.addonId || stream.streamOrigin?.addonId || null,
        addonBaseUrl:
          stream.addonBaseUrl || group.addonBaseUrl || group.streamOrigin?.addonBaseUrl || stream.streamOrigin?.addonBaseUrl || null,
        addonName: stream.addonName || group.addonName || group.streamOrigin?.addonName || stream.streamOrigin?.addonName || groupName,
        sourceProviderId:
          stream.sourceProviderId ||
          group.sourceProviderId ||
          stream.streamOrigin?.sourceProviderId ||
          group.streamOrigin?.sourceProviderId ||
          null
      };
      const entry = {
        id: stream.id || `${groupName}-${index}-${stream.url || stream.externalUrl || stream.ytId || ""}`,
        name: stream.name || null,
        title: stream.title || null,
        description: stream.description || null,
        url: stream.url || null,
        ytId: stream.ytId || null,
        infoHash: stream.infoHash || null,
        fileIdx: stream.fileIdx ?? null,
        engineFs: stream.engineFs || stream.raw?.engineFs || null,
        externalUrl: stream.externalUrl || null,
        behaviorHints: stream.behaviorHints || null,
        sources: Array.isArray(stream.sources) ? stream.sources : [],
        quality: stream.quality || null,
        qualityValue: Number.isFinite(Number(stream.qualityValue)) ? Number(stream.qualityValue) : -1,
        clientResolve: stream.clientResolve || null,
        debridCacheStatus: stream.debridCacheStatus || null,
        streamPresentation: stream.streamPresentation || null,
        subtitles: Array.isArray(stream.subtitles) ? stream.subtitles : [],
        addonId: stream.addonId || group.addonId || null,
        addonBaseUrl: stream.addonBaseUrl || group.addonBaseUrl || null,
        addonName: stream.addonName || groupName,
        addonLogo: stream.addonLogo || group.addonLogo || null,
        sourceProviderId:
          stream.sourceProviderId ||
          group.sourceProviderId ||
          stream.streamOrigin?.sourceProviderId ||
          group.streamOrigin?.sourceProviderId ||
          null,
        streamOrigin,
        addonOrderIndex: Number.isFinite(Number(stream.addonOrderIndex))
          ? Number(stream.addonOrderIndex)
          : Number(group.addonOrderIndex ?? Number.MAX_SAFE_INTEGER),
        mimeType: stream.mimeType || stream.raw?.mimeType || stream.type || stream.source || null,
        sourceType: stream.sourceType || stream.mimeType || stream.type || stream.source || "",
        raw: stream
      };
      if (
        canResolveMediaServerStream(entry) ||
        DirectDebridResolver.shouldListStream(entry) ||
        WebOsEngineFsResolver.canResolveStream(entry) ||
        TizenStreamingServerResolver.canResolveStream(entry)
      ) {
        flattened.push(entry);
      }
    });
  });
  return flattened;
}

export function mergeStreamItems(existing = [], incoming = []) {
  const order = [];
  const byKey = new Map();
  const push = (item) => {
    if (!item) {
      return;
    }
    const key = streamMergeKey(item);
    if (!key) {
      return;
    }
    if (!byKey.has(key)) {
      order.push(key);
      byKey.set(key, item);
      return;
    }
    byKey.set(key, mergeStreamItem(byKey.get(key), item));
  };
  (existing || []).forEach(push);
  (incoming || []).forEach(push);
  return order.map((key) => byKey.get(key));
}

export function getAddonBadgeLabel(name = "") {
  const cleaned = String(name || "").trim();
  if (!cleaned) {
    return "A";
  }
  if (/torrentio|torbox|torrent/i.test(cleaned)) {
    return "µ";
  }
  const letters = cleaned
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase())
    .join("")
    .slice(0, 2);
  return letters || cleaned.charAt(0).toUpperCase();
}

export async function ensureAddonLogoImageProxyReady() {
  if (!Environment.isWebOS()) {
    return false;
  }
  try {
    return await ensureWebOsImageProxyReady();
  } catch (_) {
    return false;
  }
}

export async function preloadStreamBadgeImages(settings = StreamBadgeSettingsStore.snapshot()) {
  await ensureAddonLogoImageProxyReady();
  const rules = normalizeStreamBadgeRules(settings?.rules);
  const urls = new Set();
  rules.imports.forEach((importItem) => {
    (importItem.filters || []).forEach((filter) => {
      const url = normalizeAddonLogoUrl(filter.imageURL);
      if (url) {
        urls.add(url);
      }
    });
  });
  await preloadAddonLogoUrls(urls);
}

export async function preloadMatchedStreamBadgeImages(streams = [], settings = StreamBadgeSettingsStore.snapshot()) {
  const urls = new Set();
  (streams || []).forEach((stream) => {
    matchStreamBadges(stream, settings?.rules)
      .slice(0, STREAM_BADGE_LIMIT)
      .forEach((badge) => {
        const url = normalizeAddonLogoUrl(badge.imageURL);
        if (url) {
          urls.add(url);
        }
      });
  });
  await preloadAddonLogoUrls(urls);
}

export function getStreamHeadline(stream = {}) {
  const primary = [stream.name, stream.title, stream.description].find((value) => String(value || "").trim());
  if (!primary) {
    return stream.addonName || "Unknown source";
  }
  const name = String(primary).trim();
  return Environment.isWebOS() ? normalizeMathematicalAlphanumericSymbols(name) : name;
}

export function getStreamQuality(stream = {}) {
  const qualityLines = [];
  [stream.name, stream.title, stream.description].forEach((value) => {
    String(value || "")
      .split(/\r?\n/)
      .forEach((line) => {
        const normalized = String(line || "").trim();
        if (normalized) {
          qualityLines.push(normalized);
        }
      });
  });
  const qualityCandidate = qualityLines.find((line, index) => index > 0 && /(2160|4k|1080|720|480)/i.test(line));
  if (qualityCandidate) {
    return detectQuality(qualityCandidate);
  }
  return detectQuality(
    [stream.name || "", stream.title || "", stream.description || "", stream.behaviorHints?.filename || "", stream.sourceType || ""].join(
      " "
    )
  );
}

export function getStreamDescriptionLines(stream = {}) {
  const displayDescription = String(stream.description || stream.title || "").trim();
  const displayName = String(stream.name || stream.title || stream.description || "").trim();
  if (!displayDescription || displayDescription === displayName) {
    return [];
  }
  return displayDescription
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
