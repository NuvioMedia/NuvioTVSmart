import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { streamRepository } from "../../../data/repository/streamRepository.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { watchProgressRepository } from "../../../data/repository/watchProgressRepository.js";
import { isWatchProgressInProgress } from "../../../domain/model/watchProgress.js";
import { PlayerSettingsStore } from "../../../data/local/playerSettingsStore.js";
import { StreamPreferencesStore } from "../../../data/local/streamPreferencesStore.js";
import {
  selectAutoPlayStream,
  isAutoPlayEffectivelyEnabled
} from "../../../core/streams/streamAutoPlaySelector.js";
import { buildStreamResumeIdentity } from "../../../core/streams/streamResumeIdentity.js";
import { DirectDebridResolver } from "../../../core/debrid/directDebridResolver.js";
import { DirectDebridStreamPreparer } from "../../../core/debrid/directDebridStreamPreparer.js";
import { DebridStreamPresentation } from "../../../core/debrid/directDebridStreamPresentation.js";
import { WebOsEngineFsResolver } from "../../../core/p2p/webosEngineFsResolver.js";
import { TizenStreamingServerResolver } from "../../../core/p2p/tizenStreamingServerResolver.js";
import { DebridSettingsStore } from "../../../data/local/debridSettingsStore.js";
import { StreamBadgeSettingsStore } from "../../../data/local/streamBadgeSettingsStore.js";
import {
  ensureWebOsImageProxyReady,
  onWebOsImageProxyReady
} from "../../../core/media/imageProxy.js";
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
import { WebOsLunaService } from "../../../platform/webos/webosLunaService.js";
import { I18n } from "../../../i18n/index.js";
import {
  matchStreamBadges,
  normalizeStreamBadgeChipColor,
  normalizeStreamBadgeRules
} from "../../../core/streams/streamBadgeRules.js";
import { normalizeMathematicalAlphanumericSymbols } from "../../../core/streams/streamDisplayText.js";
import { renderLoadingIndicator } from "../../components/loadingIndicator.js";
import {
  VIRTUAL_LIST_FALLBACK_VIEWPORT_PX,
  buildRowOffsets,
  computeVirtualRange,
  deriveRowStrides,
  estimateRowHeight,
  projectScrollForRow,
  virtualRangeNeedsRefresh
} from "./streamVirtualList.js";

const STREAM_BADGE_LIMIT = 9;
const WEBOS_STREAM_BADGE_OVERSCAN_RATIO = 0.35;
const WEBOS_STREAM_BADGE_MIN_OVERSCAN_PX = 180;
// Virtual list. Row geometry maths lives in streamVirtualList.js so it can be
// tested without a DOM; everything here is the DOM half.
const WEBOS_VIRTUAL_LIST_MIN_ROWS = 24;
const WEBOS_VIRTUAL_VISIBILITY_PAD_PX = 16;
const WEBOS_NATIVE_PLAYER_APP_IDS = [
  "com.webos.app.mediadiscovery",
  "com.webos.app.photovideo",
  "com.webos.app.smartshare"
];
const WEBOS_DLNA_PROTOCOL_SUFFIX =
  "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000";
function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value = "") {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isLaunchableExternalMediaUrl(value = "") {
  try {
    const parsed = new URL(String(value || "").trim());
    return (
      parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "file:"
    );
  } catch (_) {
    return false;
  }
}

function isLocalOnlyPlaybackUrl(value = "") {
  try {
    const parsed = new URL(String(value || "").trim());
    if (parsed.protocol === "file:") {
      return false;
    }
    return (
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "localhost" ||
      parsed.hostname === "::1"
    );
  } catch (_) {
    return false;
  }
}

function buildWebOsDlnaProtocolInfo(mimeType = "video/mp4") {
  const normalized = String(mimeType || "video/mp4").trim() || "video/mp4";
  return `http-get:*:${normalized}:${WEBOS_DLNA_PROTOCOL_SUFFIX}`;
}

function normalizeExternalLaunchFileName(value = "") {
  const trimmed = String(value || "").trim();
  return (
    trimmed
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "Nuvio"
  );
}

function guessMimeTypeFromUrl(url = "") {
  const value = String(url || "")
    .trim()
    .toLowerCase();
  if (!value) {
    return null;
  }
  const extensionMatch = value.match(
    /\.(m3u8|mpd|mp4|m4v|mov|mkv|webm|ts|m2ts|mp3|aac|flac)(?=($|[/?#&]))/i
  );
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

function getDpadDirection(event) {
  const keyCode = Number(event?.keyCode || 0);
  const key = String(event?.key || "").toLowerCase();
  if (keyCode === 37 || key === "arrowleft" || key === "left") return "left";
  if (keyCode === 39 || key === "arrowright" || key === "right") return "right";
  if (keyCode === 38 || key === "arrowup" || key === "up") return "up";
  if (keyCode === 40 || key === "arrowdown" || key === "down") return "down";
  return null;
}

function isBackEvent(event) {
  return Environment.isBackEvent(event);
}

function normalizeType(itemType) {
  const normalized = String(itemType || "movie").toLowerCase();
  return normalized || "movie";
}

function detectQuality(text = "") {
  const value = String(text).toLowerCase();
  if (value.includes("2160") || value.includes("4k")) return "4k";
  if (value.includes("1080")) return "1080p";
  if (value.includes("720")) return "720p";
  if (value.includes("480")) return "480p";
  return "Auto";
}

function isMagnetUrl(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .startsWith("magnet:");
}

function streamDebridIdentity(item = {}) {
  const resolve = item.clientResolve || item.raw?.clientResolve || {};
  const behaviorHints = item.behaviorHints || item.raw?.behaviorHints || {};
  const infoHash = item.infoHash || item.raw?.infoHash || resolve.infoHash || "";
  const magnetUri =
    resolve.magnetUri ||
    (isMagnetUrl(item.url) ? item.url : "") ||
    (isMagnetUrl(item.externalUrl) ? item.externalUrl : "");
  const hasDebridMarker = Boolean(
    item.clientResolve ||
    item.raw?.clientResolve ||
    item.debridCacheStatus ||
    item.raw?.debridCacheStatus ||
    infoHash ||
    magnetUri
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
    String(
      resolve.service ||
        item.debridCacheStatus?.providerId ||
        item.raw?.debridCacheStatus?.providerId ||
        ""
    ),
    String(locator),
    String(resolve.fileIdx ?? item.fileIdx ?? item.raw?.fileIdx ?? ""),
    String(behaviorHints.filename || resolve.filename || ""),
    String(resolve.torrentName || "")
  ].join("::");
}

function streamMergeKey(item = {}) {
  const debridIdentity = streamDebridIdentity(item);
  if (debridIdentity) {
    return `debrid::${debridIdentity}`;
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

function mergeStreamItem(previous = {}, next = {}) {
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
    subtitles:
      Array.isArray(next.subtitles) && next.subtitles.length ? next.subtitles : previous.subtitles,
    sources: Array.isArray(next.sources) && next.sources.length ? next.sources : previous.sources,
    streamPresentation: next.streamPresentation || previous.streamPresentation || null
  };
}

function formatBytes(value) {
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

function normalizeEpisodeCode(season, episode) {
  const seasonNumber = Number(season);
  const episodeNumber = Number(episode || 0);
  if (
    season == null ||
    !Number.isFinite(seasonNumber) ||
    seasonNumber < 0 ||
    episodeNumber <= 0
  ) {
    return "";
  }
  return `S${seasonNumber} E${episodeNumber}`;
}

function flattenStreams(streamResult) {
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
        addonId:
          stream.addonId ||
          group.addonId ||
          group.streamOrigin?.addonId ||
          stream.streamOrigin?.addonId ||
          null,
        addonBaseUrl:
          stream.addonBaseUrl ||
          group.addonBaseUrl ||
          group.streamOrigin?.addonBaseUrl ||
          stream.streamOrigin?.addonBaseUrl ||
          null,
        addonName:
          stream.addonName ||
          group.addonName ||
          group.streamOrigin?.addonName ||
          stream.streamOrigin?.addonName ||
          groupName,
        sourceProviderId:
          stream.sourceProviderId ||
          group.sourceProviderId ||
          stream.streamOrigin?.sourceProviderId ||
          group.streamOrigin?.sourceProviderId ||
          null
      };
      const entry = {
        id:
          stream.id ||
          `${groupName}-${index}-${stream.url || stream.externalUrl || stream.ytId || ""}`,
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
        qualityValue: Number.isFinite(Number(stream.qualityValue))
          ? Number(stream.qualityValue)
          : -1,
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

function mergeStreamItems(existing = [], incoming = []) {
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

function getAddonBadgeLabel(name = "") {
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

async function ensureAddonLogoImageProxyReady() {
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

async function preloadMatchedStreamBadgeImages(
  streams = [],
  settings = StreamBadgeSettingsStore.snapshot()
) {
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

function getStreamHeadline(stream = {}) {
  const primary = [stream.name, stream.title, stream.description].find((value) =>
    String(value || "").trim()
  );
  if (!primary) {
    return stream.addonName || "Unknown source";
  }
  const firstLine = String(primary).split(/\r?\n/)[0].trim();
  const displayLine = Environment.isWebOS()
    ? normalizeMathematicalAlphanumericSymbols(firstLine)
    : firstLine;
  return displayLine || stream.addonName || "Unknown source";
}

function getStreamQuality(stream = {}) {
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
  const qualityCandidate = qualityLines.find(
    (line, index) => index > 0 && /(2160|4k|1080|720|480)/i.test(line)
  );
  if (qualityCandidate) {
    return detectQuality(qualityCandidate);
  }
  return detectQuality(
    [
      stream.name || "",
      stream.title || "",
      stream.description || "",
      stream.behaviorHints?.filename || "",
      stream.sourceType || ""
    ].join(" ")
  );
}

function getStreamDescriptionLines(stream = {}) {
  const displayDescription = String(stream.description || stream.title || "").trim();
  const displayName = String(stream.name || stream.title || stream.description || "").trim();
  if (!displayDescription || displayDescription === displayName) {
    return [];
  }
  return displayDescription
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function renderImageBadgeChip(badge = {}) {
  const imageUrl = normalizeAddonLogoUrl(badge.imageURL);
  if (!imageUrl) {
    return "";
  }
  let displayImageUrl = getCachedAddonLogoDisplayUrl(imageUrl);
  if (imageUrl && !displayImageUrl && !hasFailedAddonLogo(imageUrl)) {
    requestAddonLogo(imageUrl);
    if (Environment.isWebOS()) {
      displayImageUrl = getCachedAddonLogoDisplayUrl(imageUrl);
    }
  }
  const backgroundColor = normalizeStreamBadgeChipColor(badge.tagColor);
  const outlineColor = normalizeStreamBadgeChipColor(badge.borderColor);
  const textColor = normalizeStreamBadgeChipColor(badge.textColor);
  const filled =
    String(badge.tagStyle || "")
      .trim()
      .toLowerCase() === "filled";
  const fallbackImageUrl = Environment.isWebOS() ? "" : imageUrl;
  const safeImageUrl = displayImageUrl || fallbackImageUrl;
  if (!safeImageUrl) {
    return "";
  }
  const style = [
    filled && backgroundColor ? `background:${backgroundColor};` : "",
    outlineColor ? `border-color:${outlineColor};` : "",
    textColor ? `color:${textColor};` : ""
  ].join("");
  return `
    <span class="stream-route-stream-badge image${filled ? " filled" : ""}"${style ? ` style="${escapeHtml(style)}"` : ""}>
      <img src="${escapeHtml(safeImageUrl)}" alt="${escapeHtml(badge.name || "")}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
    </span>
  `;
}

function renderImportedStreamBadgeChipContents(
  stream = {},
  badges = [],
  showFileSizeBadges = true
) {
  const sizeBytes = stream.behaviorHints?.videoSize;
  const chips = [];
  badges.slice(0, STREAM_BADGE_LIMIT).forEach((badge) => {
    const chip = renderImageBadgeChip(badge);
    if (chip) {
      chips.push(chip);
    }
  });
  if (showFileSizeBadges && sizeBytes != null) {
    chips.push(
      `<span class="stream-route-stream-badge size">${escapeHtml(t("streams_size", [formatBytes(sizeBytes)], `SIZE ${formatBytes(sizeBytes)}`))}</span>`
    );
  }
  return chips.join("");
}

function renderImportedStreamBadgeChips(stream = {}, badges = [], showFileSizeBadges = true) {
  const contents = renderImportedStreamBadgeChipContents(
    stream,
    badges,
    showFileSizeBadges
  );
  return contents
    ? `<div class="stream-route-card-badges" aria-label="${escapeHtml(t("settings_stream_badges_section", {}, "Fusion Style"))}">${contents}</div>`
    : "";
}

function renderStreamBadges(stream = {}, enabled = true, badgeSettings = null) {
  if (!enabled) {
    return "";
  }
  const currentBadgeSettings = badgeSettings || StreamBadgeSettingsStore.snapshot();
  const importedBadges = matchStreamBadges(stream, currentBadgeSettings.rules);
  return renderImportedStreamBadgeChips(
    stream,
    importedBadges,
    currentBadgeSettings.showFileSizeBadges !== false
  );
}

function hasStreamBadges(stream = {}, enabled = true, badgeSettings = null) {
  if (!enabled) {
    return false;
  }
  const currentBadgeSettings = badgeSettings || StreamBadgeSettingsStore.snapshot();
  if (
    currentBadgeSettings.showFileSizeBadges !== false &&
    stream.behaviorHints?.videoSize != null
  ) {
    return true;
  }
  return matchStreamBadges(stream, currentBadgeSettings.rules).some(
    (badge) => normalizeAddonLogoUrl(badge.imageURL)
  );
}

function renderStreamBadgeContents(stream = {}, enabled = true, badgeSettings = null) {
  if (!enabled) {
    return "";
  }
  const currentBadgeSettings = badgeSettings || StreamBadgeSettingsStore.snapshot();
  return renderImportedStreamBadgeChipContents(
    stream,
    matchStreamBadges(stream, currentBadgeSettings.rules),
    currentBadgeSettings.showFileSizeBadges !== false
  );
}

function resolveStreamBadgePlacement(badgeSettings = null) {
  const placement = String(
    (badgeSettings || StreamBadgeSettingsStore.snapshot()).badgePlacement || "BOTTOM"
  )
    .trim()
    .toUpperCase();
  return placement === "TOP" ? "TOP" : "BOTTOM";
}

function getOrderedFilterNames(sourceChips = [], streams = []) {
  const ordered = [];
  const sortedChips = (sourceChips || [])
    .slice()
    .sort(
      (left, right) =>
        Number(left?.orderIndex ?? Number.MAX_SAFE_INTEGER) -
        Number(right?.orderIndex ?? Number.MAX_SAFE_INTEGER)
    );
  sortedChips.forEach((chip) => {
    if (chip?.name && !ordered.includes(chip.name)) {
      ordered.push(chip.name);
    }
  });
  const sortedStreams = (streams || [])
    .map((stream, index) => ({ stream, index }))
    .sort((left, right) => {
      const leftOrder = Number(left.stream?.addonOrderIndex ?? Number.MAX_SAFE_INTEGER);
      const rightOrder = Number(right.stream?.addonOrderIndex ?? Number.MAX_SAFE_INTEGER);
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.stream);
  sortedStreams.forEach((stream) => {
    const addonName = String(stream?.addonName || "").trim();
    if (addonName && !ordered.includes(addonName)) {
      ordered.push(addonName);
    }
  });
  return ordered;
}

function sortStreamsByAddonOrder(streams = [], sourceChips = []) {
  const order = new Map();
  (sourceChips || []).forEach((chip, index) => {
    const name = String(chip?.name || "").trim();
    if (name && !order.has(name)) {
      order.set(name, index);
    }
  });
  return (streams || [])
    .map((stream, index) => ({ stream, index }))
    .sort((left, right) => {
      const leftOrder = order.has(left.stream?.addonName)
        ? order.get(left.stream.addonName)
        : Number(left.stream?.addonOrderIndex ?? Number.MAX_SAFE_INTEGER);
      const rightOrder = order.has(right.stream?.addonName)
        ? order.get(right.stream.addonName)
        : Number(right.stream?.addonOrderIndex ?? Number.MAX_SAFE_INTEGER);
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.stream);
}

export const StreamScreen = {
  cancelScheduledRender() {
    if (this.renderDelayTimer) {
      clearTimeout(this.renderDelayTimer);
      this.renderDelayTimer = null;
    }
    if (this.renderFrame) {
      cancelAnimationFrame(this.renderFrame);
      this.renderFrame = null;
    }
    if (this.streamBadgeHydrationFrame) {
      cancelAnimationFrame(this.streamBadgeHydrationFrame);
      this.streamBadgeHydrationFrame = null;
    }
  },

  // Every cache below is keyed to the markup or the stream arrays that render()
  // is about to replace, so drop them all in one place.
  invalidateStreamRouteCaches() {
    this.filteredStreamsCache = null;
    this.cardRowsCache = null;
    this.chipNodesCache = null;
    this.focusedNode = null;
  },

  requestRender({ delayMs = 0 } = {}) {
    if (!this.container || Router.getCurrent() !== "stream") {
      return;
    }
    const delay = Math.max(0, Number(delayMs || 0));
    if (delay > 0) {
      if (this.renderFrame || this.renderDelayTimer) {
        return;
      }
      this.renderDelayTimer = setTimeout(() => {
        this.renderDelayTimer = null;
        this.requestRender();
      }, delay);
      return;
    }
    if (this.renderFrame) {
      return;
    }
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = null;
      if (!this.container || Router.getCurrent() !== "stream") {
        return;
      }
      this.render();
    });
  },

  applyAddonLogos(streams = []) {
    const lookup = this.addonLogoLookup || {};
    return (streams || []).map((stream) => {
      const currentLogo = normalizeAddonLogoUrl(stream?.addonLogo);
      if (currentLogo) {
        return stream;
      }
      const addonLogo = resolveAddonLogo(stream?.addonName, lookup);
      return addonLogo ? { ...stream, addonLogo } : stream;
    });
  },

  areAddonLogosReady(streams = []) {
    if (StreamBadgeSettingsStore.snapshot().showAddonLogo !== true) {
      return true;
    }
    return (streams || []).every((stream) => {
      const addonLogoUrl =
        normalizeAddonLogoUrl(stream?.addonLogo) ||
        resolveAddonLogo(stream?.addonName, this.addonLogoLookup);
      if (!addonLogoUrl || hasFailedAddonLogo(addonLogoUrl)) {
        return true;
      }
      return Boolean(getCachedAddonLogoDisplayUrl(addonLogoUrl));
    });
  },

  requestAddonLogoPrerender(streams = []) {
    if (StreamBadgeSettingsStore.snapshot().showAddonLogo !== true) {
      return;
    }
    const urls = Array.from(
      new Set(
        (streams || [])
          .map(
            (stream) =>
              normalizeAddonLogoUrl(stream?.addonLogo) ||
              resolveAddonLogo(stream?.addonName, this.addonLogoLookup)
          )
          .filter(
            (url) => url && !hasFailedAddonLogo(url) && !getCachedAddonLogoDisplayUrl(url)
          )
      )
    );
    if (!urls.length) {
      return;
    }
    const key = urls.sort().join("|");
    if (this.pendingAddonLogoPrerenderKey === key) {
      return;
    }
    const token = this.loadToken || 0;
    this.pendingAddonLogoPrerenderKey = key;
    void preloadAddonLogoImages(streams, this.addonLogoLookup).finally(() => {
      if (this.pendingAddonLogoPrerenderKey === key) {
        this.pendingAddonLogoPrerenderKey = "";
      }
      if (this.container && Router.getCurrent() === "stream" && token === this.loadToken) {
        this.requestRender();
      }
    });
  },

  scheduleDebridPreparation() {
    const token = this.loadToken || 0;
    if (this.debridPreparationScheduled) {
      return;
    }
    this.debridPreparationScheduled = true;
    setTimeout(() => {
      this.debridPreparationScheduled = false;
      if (!this.container || Router.getCurrent() !== "stream" || token !== this.loadToken) {
        return;
      }
      const season = this.params?.season == null ? null : Number(this.params.season);
      const episode = this.params?.episode == null ? null : Number(this.params.episode);
      void DirectDebridStreamPreparer.prepare(this.streams, {
        season,
        episode,
        onPrepared: (original, prepared) => {
          if (!this.container || Router.getCurrent() !== "stream" || token !== this.loadToken) {
            return;
          }
          const keyFor = (stream) =>
            [
              stream.clientResolve?.service || "",
              stream.clientResolve?.infoHash || stream.infoHash || "",
              stream.clientResolve?.fileIdx ?? stream.fileIdx ?? "",
              stream.clientResolve?.filename || stream.behaviorHints?.filename || "",
              stream.name || "",
              stream.title || ""
            ].join("|");
          const originalKey = keyFor(original);
          this.streams = this.streams.map((stream) =>
            keyFor(stream) === originalKey ? { ...stream, ...prepared } : stream
          );
          this.requestRender();
        }
      });
    }, 0);
  },

  getBackdropUrl() {
    return this.params?.backdrop || this.params?.landscapePoster || this.params?.poster || "";
  },

  getRouteStateKey(params = {}) {
    const itemType = normalizeType(params?.itemType);
    const itemId = String(params?.itemId || "").trim();
    const videoId = String(params?.videoId || "").trim();
    if (!itemId && !videoId) {
      return null;
    }
    return `stream:${itemType}:${itemId}:${videoId}`;
  },

  navigateBackFromStream() {
    const itemId = String(this.params?.itemId || "").trim();
    if (!itemId) {
      return false;
    }
    const itemType = normalizeType(this.params?.itemType);
    const isSeries = itemType === "series" || itemType === "tv";
    if (this.params?.continueWatchingBackHome && !isSeries) {
      // Android returns movies opened from Continue Watching straight Home;
      // only episodic content reconstructs a Detail route on Back.
      void Router.navigate(
        "home",
        {},
        {
          skipStackPush: true,
          replaceHistory: true,
          isBackNavigation: true
        }
      );
      return true;
    }
    void Router.navigate(
      "detail",
      {
        itemId,
        itemType,
        imdbId: this.params?.imdbId || null,
        tmdbId: this.params?.tmdbId || null,
        traktId: this.params?.traktId || null,
        originalItemId: this.params?.originalItemId || null,
        fallbackTitle: this.params?.itemTitle || this.params?.playerTitle || "Untitled",
        returnHomeOnBack: Boolean(
          this.params?.continueWatchingBackHome ||
          this.params?.returnHomeOnBack ||
          this.params?.returnToDetail ||
          this.params?.fromDetailRoute
        )
      },
      {
        skipStackPush: true,
        replaceHistory: true,
        isBackNavigation: true
      }
    );
    return true;
  },

  consumeBackRequest() {
    return this.navigateBackFromStream();
  },

  captureRouteState() {
    const list = this.container?.querySelector(".stream-route-list");
    return {
      params: this.params ? { ...this.params } : {},
      loading: Boolean(this.loading),
      error: String(this.error || ""),
      streams: Array.isArray(this.streams) ? this.streams.map((stream) => ({ ...stream })) : [],
      addonFilter: String(this.addonFilter || "all"),
      focusState: this.focusState ? { ...this.focusState } : { zone: "filter", index: 0 },
      sourceChips: Array.isArray(this.sourceChips)
        ? this.sourceChips.map((chip) => ({ ...chip }))
        : [],
      addonLogoLookup: this.addonLogoLookup ? { ...this.addonLogoLookup } : {},
      listScrollTop: this.getListScrollTop(list)
    };
  },

  async mount(params = {}, navigationContext = {}) {
    this.container = document.getElementById("stream");
    ScreenUtils.show(this.container);
    this.params = params || {};
    this.loadToken = (this.loadToken || 0) + 1;
    const token = this.loadToken;
    this.focusState = { zone: "filter", index: 0 };
    this.listScrollTop = 0;
    this.error = "";
    this.loading = true;
    this.streams = [];
    this.sourceChips = [];
    this.addonLogoLookup = {};
    this.addonFilter = "all";
    this.hasRenderedStreamRouteShell = false;
    this.invalidateStreamRouteCaches();
    this.virtualGeometryKey = "";
    this.resetVirtualGeometry();
    // Returning here from the player is a back navigation, not a fresh open, so
    // do not auto-resume or auto-play again. Otherwise exiting the player drops
    // back onto the stream list and immediately relaunches, looping forever.
    const returningFromPlayer = Boolean(navigationContext?.isBackNavigation);
    this.autoResumeAttempted = returningFromPlayer;
    const playerSettings = PlayerSettingsStore.get();
    const reusableStream = playerSettings.streamReuseLastLinkEnabled
      ? StreamPreferencesStore.getValid(
          this.params?.itemId,
          this.params?.videoId || this.params?.itemId,
          Number(playerSettings.streamReuseLastLinkCacheHours || 24) * 60 * 60 * 1000
        )
      : null;
    this.autoResumeUiActive = Boolean(
      !navigationContext?.isBackNavigation &&
      this.params?.continueWatchingBackHome &&
      !this.params?.manualSelection &&
      reusableStream?.streamId &&
      (String(this.params?.resumeStreamIdentity || "").trim() ||
        String(this.params?.preferredStreamId || "").trim())
    );
    this.autoPlayAttempted = returningFromPlayer;
    this.cancelAutoPlayCountdown();
    this.cancelAutoPlaySelectionWait();
    const autoPlayWaitSeconds = Math.max(0, Math.trunc(Number(playerSettings.streamAutoPlayTimeoutSeconds || 0)));
    this.autoPlaySelectionReady = autoPlayWaitSeconds === 0;
    if (autoPlayWaitSeconds > 0 && autoPlayWaitSeconds !== 2147483647) {
      this.autoPlaySelectionWaitTimer = setTimeout(() => {
        this.autoPlaySelectionWaitTimer = null;
        this.autoPlaySelectionReady = true;
        this.maybeAutoResumeStream();
        this.maybeAutoPlayStream();
      }, autoPlayWaitSeconds * 1000);
    }
    this.webOsNativePlayerAppId = "";
    this.nativePlayerPendingStreamId = "";
    this.nativePlayerRequestToken = 0;
    if (this.releaseImageProxyReadyListener) {
      this.releaseImageProxyReadyListener();
      this.releaseImageProxyReadyListener = null;
    }
    if (Environment.isWebOS()) {
      this.releaseImageProxyReadyListener = onWebOsImageProxyReady(() => {
        clearFailedAddonLogos();
        this.requestRender({ delayMs: 0 });
      });
      void ensureWebOsImageProxyReady();
      void this.detectWebOsNativePlayerApp();
    }

    // Match Android TV: restore the selected source only when returning from
    // playback. A fresh open of the same item must start from the first source
    // instead of inheriting an old list scroll/focus snapshot.
    const restored =
      navigationContext?.isBackNavigation &&
      navigationContext?.restoredState && typeof navigationContext.restoredState === "object"
        ? navigationContext.restoredState
        : null;
    if (restored) {
      this.loading = Boolean(restored.loading);
      this.error = String(restored.error || "");
      this.streams = Array.isArray(restored.streams)
        ? restored.streams.map((stream) => ({ ...stream }))
        : [];
      this.addonFilter = String(restored.addonFilter || "all");
      this.focusState = restored.focusState
        ? { ...restored.focusState }
        : { zone: "filter", index: 0 };
      this.sourceChips = Array.isArray(restored.sourceChips)
        ? restored.sourceChips.map((chip) => ({ ...chip }))
        : [];
      this.addonLogoLookup =
        restored.addonLogoLookup && typeof restored.addonLogoLookup === "object"
          ? normalizeAddonLogoLookup(restored.addonLogoLookup)
          : {};
      this.listScrollTop = Number(restored.listScrollTop || 0);
    }

    const showAddonLogo = StreamBadgeSettingsStore.snapshot().showAddonLogo === true;
    if (restored && this.streams.length && showAddonLogo) {
      await ensureAddonLogoImageProxyReady();
      if (token !== this.loadToken || Router.getCurrent() !== "stream") {
        return;
      }
      this.streams = this.applyAddonLogos(this.streams);
      await preloadAddonLogoImages(this.streams, this.addonLogoLookup);
      if (token !== this.loadToken || Router.getCurrent() !== "stream") {
        return;
      }
    }

    this.render();

    if (restored && navigationContext?.isBackNavigation && this.streams.length) {
      this.loading = false;
      this.render();
      return;
    }

    void this.loadStreams();
  },

  async loadStreams() {
    const token = this.loadToken;
    const itemType = normalizeType(this.params?.itemType);
    const videoId = String(this.params?.videoId || this.params?.itemId || "");

    this.loading = true;
    this.error = "";
    this.streams = [];
    this.addonFilter = "all";
    this.focusState = { zone: "filter", index: 0 };
    this.listScrollTop = 0;
    this.addonLogoLookup = {};

    this.sourceChips = [];
    this.invalidateStreamRouteCaches();
    this.virtualGeometryKey = "";
    this.resetVirtualGeometry();
    if (!this.hasRenderedStreamRouteShell) {
      this.requestRender();
    }
    const pendingChunkTasks = new Set();
    const badgeSettings = StreamBadgeSettingsStore.snapshot();
    const showAddonLogo = badgeSettings.showAddonLogo === true;
    if (showAddonLogo) {
      await ensureAddonLogoImageProxyReady();
      if (token !== this.loadToken) {
        return;
      }
    }

    const upsertSourceChip = (addon, status = "loading") => {
      const name = String(addon?.displayName || addon?.name || "").trim();
      if (!name) {
        return;
      }
      const orderIndex = Number(addon?.orderIndex);
      const nextChip = {
        name,
        logo: normalizeAddonLogoUrl(addon.logo),
        status,
        orderIndex: Number.isFinite(orderIndex) ? orderIndex : Number.MAX_SAFE_INTEGER
      };
      const existingIndex = this.sourceChips.findIndex((chip) => chip.name === name);
      if (existingIndex >= 0) {
        this.sourceChips[existingIndex] = { ...this.sourceChips[existingIndex], ...nextChip };
      } else {
        this.sourceChips.push(nextChip);
      }
      rememberAddonLogoLookup(this.addonLogoLookup, name, addon.logo || nextChip.logo);
      this.sourceChips = this.sourceChips
        .slice()
        .sort((left, right) => Number(left.orderIndex || 0) - Number(right.orderIndex || 0));
    };

    const markSuccessfulSources = (names = []) => {
      if (!Array.isArray(names) || !names.length) {
        return;
      }
      const entries = names
        .map((entry) => {
          if (entry && typeof entry === "object") {
            return {
              name: String(entry.name || entry.addonName || "").trim(),
              logo: normalizeAddonLogoUrl(entry.logo || entry.addonLogo),
              orderIndex: Number(entry.orderIndex ?? entry.addonOrderIndex)
            };
          }
          const name = String(entry || "").trim();
          const existingStream = this.streams.find((stream) => stream.addonName === name);
          return {
            name,
            logo: resolveAddonLogo(name, this.addonLogoLookup),
            orderIndex: Number(existingStream?.addonOrderIndex)
          };
        })
        .filter((entry) => entry.name);
      const successSet = new Set(entries.map((entry) => entry.name));
      const known = new Set(this.sourceChips.map((chip) => chip.name));
      this.sourceChips = this.sourceChips.map((chip) =>
        successSet.has(chip.name) ? { ...chip, status: "success" } : chip
      );
      entries.forEach((entry) => {
        if (!known.has(entry.name)) {
          const orderIndex = Number.isFinite(entry.orderIndex)
            ? entry.orderIndex
            : Number.MAX_SAFE_INTEGER;
          this.sourceChips.push({
            name: entry.name,
            logo: entry.logo || resolveAddonLogo(entry.name, this.addonLogoLookup),
            status: "success",
            orderIndex
          });
        }
      });
      this.sourceChips = this.sourceChips
        .slice()
        .sort(
          (left, right) =>
            Number(left.orderIndex ?? Number.MAX_SAFE_INTEGER) -
            Number(right.orderIndex ?? Number.MAX_SAFE_INTEGER)
        );
    };

    const displayChunkGroups = async (groups = []) => {
      if (token !== this.loadToken) {
        return;
      }
      const chunkStreams = mergeStreamItems(
        [],
        this.applyAddonLogos(flattenStreams({ status: "success", data: groups }))
      );
      if (!chunkStreams.length) {
        return;
      }
      await Promise.all([
        preloadMatchedStreamBadgeImages(chunkStreams, badgeSettings),
        ...(showAddonLogo
          ? [preloadAddonLogoImages(chunkStreams, this.addonLogoLookup)]
          : [])
      ]);
      if (token !== this.loadToken) {
        return;
      }
      this.streams = mergeStreamItems(this.streams, chunkStreams);
      this.scheduleDebridPreparation();
      markSuccessfulSources(
        groups.map((group) => ({
          name: group?.addonName || "",
          logo: group?.addonLogo || "",
          orderIndex: group?.addonOrderIndex
        }))
      );
      if (this.streams.length && this.focusState?.zone !== "card") {
        this.focusState = { zone: "card", row: 0, action: "play" };
      }
      this.requestRender({ delayMs: 120 });
      this.maybeAutoResumeStream();
      this.maybeAutoPlayStream();
    };

    const queueChunkGroups = (groups = []) => {
      const task = displayChunkGroups(groups)
        .catch((error) => {
          console.warn("Stream chunk prerender failed", error);
        })
        .finally(() => {
          pendingChunkTasks.delete(task);
        });
      pendingChunkTasks.add(task);
      return task;
    };

    const options = {
      itemId: String(this.params?.itemId || ""),
      season: this.params?.season ?? null,
      episode: this.params?.episode ?? null,
      onAddon: (addon) => {
        if (token !== this.loadToken) {
          return;
        }
        upsertSourceChip(addon, "loading");
        this.requestRender({ delayMs: 120 });
      },
      onChunk: (chunkResult) => {
        if (token !== this.loadToken || chunkResult?.status !== "success") {
          return;
        }
        const groups = Array.isArray(chunkResult.data) ? chunkResult.data : [];
        queueChunkGroups(groups);
      }
    };

    try {
      const streamResult = await streamRepository.getStreamsFromAllAddons(
        itemType,
        videoId,
        options
      );
      if (token !== this.loadToken) {
        return;
      }
      const loadedStreams = mergeStreamItems(
        [],
        this.applyAddonLogos(flattenStreams(streamResult))
      );
      await Promise.allSettled(Array.from(pendingChunkTasks));
      if (token !== this.loadToken) {
        return;
      }
      const existingKeys = new Set(
        this.streams.map((stream) => streamMergeKey(stream)).filter(Boolean)
      );
      const missingStreams = loadedStreams.filter((stream) => {
        const key = streamMergeKey(stream);
        return key && !existingKeys.has(key);
      });
      if (missingStreams.length) {
        await Promise.all([
          preloadMatchedStreamBadgeImages(missingStreams, badgeSettings),
          ...(showAddonLogo
            ? [preloadAddonLogoImages(missingStreams, this.addonLogoLookup)]
            : [])
        ]);
        if (token !== this.loadToken) {
          return;
        }
        this.streams = mergeStreamItems(this.streams, missingStreams);
      }
      this.scheduleDebridPreparation();
      markSuccessfulSources(this.streams.map((stream) => stream.addonName));
      if (this.streams.length && showAddonLogo) {
        await preloadAddonLogoImages(this.streams, this.addonLogoLookup);
      }
      this.sourceChips = this.sourceChips.map((chip) =>
        chip.status === "loading" ? { ...chip, status: "error" } : chip
      );
      this.loading = false;
      if (this.streams.length) {
        const visibleStreams = this.getFilteredStreams();
        const maxCardIndex = Math.max(0, visibleStreams.length - 1);
        let initialIndex = clamp(Number(this.focusState?.index || 0), 0, maxCardIndex);
        const preferred = String(this.params?.preferredStreamId || "").trim();
        if (preferred) {
          const prefIdx = visibleStreams.findIndex((s) => String(s?.id || "") === preferred);
          if (prefIdx >= 0) {
            initialIndex = prefIdx;
          }
        }
        const rowIndex = clamp(initialIndex, 0, this.streams.length - 1);
        this.focusState = {
          zone: "card",
          index: clamp(initialIndex, 0, maxCardIndex),
          row: rowIndex,
          action: String(this.focusState?.action || "play")
        };
      } else {
        this.focusState = { zone: "filter", index: 0 };
      }
      this.requestRender();
      this.scheduleErrorChipCleanup();
      this.maybeAutoResumeStream({ allLoaded: true });
      this.maybeAutoPlayStream({ allLoaded: true });
    } catch (error) {
      if (token !== this.loadToken) {
        return;
      }
      this.loading = false;
      this.autoResumeUiActive = false;
      this.error = error?.message || "Failed to load streams.";
      this.sourceChips = this.sourceChips.map((chip) =>
        chip.status === "loading" ? { ...chip, status: "error" } : chip
      );
      this.requestRender();
      this.scheduleErrorChipCleanup();
    }
  },

  // Continue Watching can pass the identity of the stream that was playing.
  // If that same source shows up again, resume it directly.
  maybeAutoResumeStream({ allLoaded = false } = {}) {
    if (this.autoResumeAttempted) {
      return;
    }
    const settings = PlayerSettingsStore.get();
    const reusableStream = settings.streamReuseLastLinkEnabled
      ? StreamPreferencesStore.getValid(
          this.params?.itemId,
          this.params?.videoId || this.params?.itemId,
          Number(settings.streamReuseLastLinkCacheHours || 24) * 60 * 60 * 1000
        )
      : null;
    const progressIdentity = reusableStream
      ? String(this.params?.resumeStreamIdentity || "").trim()
      : "";
    const preferredStreamId = String(reusableStream?.streamId || "").trim();
    const canReuseStoredStream = Boolean(
      this.params?.continueWatchingBackHome && !this.params?.manualSelection && reusableStream
    );
    const cachedIdentity = canReuseStoredStream
      ? String(reusableStream?.resumeIdentity || "").trim()
      : "";
    const canReusePreferredStream = Boolean(
      canReuseStoredStream && preferredStreamId
    );
    if (!progressIdentity && !cachedIdentity && !canReusePreferredStream) {
      this.autoResumeUiActive = false;
      return;
    }
    if (!this.streams.length) {
      if (!this.loading) {
        this.autoResumeAttempted = true;
        this.autoResumeUiActive = false;
        this.requestRender({ delayMs: 0 });
      }
      return;
    }
    const identityMatch = this.streams.find((stream) => {
      const stableIdentity = buildStreamResumeIdentity(stream);
      return Boolean(
        (cachedIdentity && stableIdentity === cachedIdentity) ||
        (progressIdentity && (
          stableIdentity === progressIdentity ||
          streamMergeKey(stream) === progressIdentity
        ))
      );
    }) || null;
    // Stream preferences are stored per profile and per video. They are the
    // Web equivalent of Android's local stream-link cache and remain available
    // even when the selected progress source cannot carry stream metadata.
    const match =
      identityMatch ||
      (canReusePreferredStream
        ? this.streams.find((stream) => String(stream?.id || "") === preferredStreamId)
        : null);
    if (match?.id) {
      this.autoResumeAttempted = true;
      void this.playStream(match.id);
      return;
    }
    if (!allLoaded && this.loading) {
      return;
    }
    // The remembered source is no longer available. Fall back to the normal
    // source panel instead of leaving the direct-resume loading state visible.
    this.autoResumeAttempted = true;
    this.autoResumeUiActive = false;
    this.requestRender({ delayMs: 0 });
  },

  maybeAutoPlayStream({ allLoaded = false } = {}) {
    if (this.autoResumeUiActive || this.autoPlayAttempted || this.autoPlayCountdown) {
      return;
    }
    // Resume already navigated away, or there is nothing to play.
    if (Router.getCurrent() !== "stream" || !this.streams.length) {
      return;
    }
    const settings = PlayerSettingsStore.get();
    if (this.params?.manualSelection) {
      return;
    }
    if (!allLoaded && !this.autoPlaySelectionReady) {
      return;
    }
    // "Manual (choose stream)" is authoritative for a fresh stream screen.
    // Persisted binge groups may still guide an enabled auto-play mode and the
    // next-episode player flow, but must not turn Continue Watching or Details
    // into an implicit auto-play entry point.
    const autoPlayMode = String(settings.streamAutoPlayMode || "MANUAL").toUpperCase();
    if (autoPlayMode === "MANUAL" || !isAutoPlayEffectivelyEnabled(settings)) {
      return;
    }
    const savedPreference = settings.streamAutoPlayPreferBingeGroupForNextEpisode &&
      settings.streamAutoPlayReuseBingeGroup
      ? StreamPreferencesStore.getEntry(
          this.params?.itemId,
          this.params?.videoId || this.params?.itemId
        )
      : null;
    const preferredBingeGroup = String(savedPreference?.bingeGroup || "").trim();
    const installedAddonNames = new Set(
      (addonRepository.getCachedInstalledAddons() || [])
        .map((addon) => String(addon?.displayName || addon?.name || "").trim())
        .filter(Boolean)
    );
    const selected = selectAutoPlayStream(this.getFilteredStreams(), {
      mode: settings.streamAutoPlayMode,
      source: settings.streamAutoPlaySource,
      regexPattern: settings.streamAutoPlayRegex,
      installedAddonNames,
      selectedAddons: settings.streamAutoPlaySelectedAddons,
      selectedPlugins: settings.streamAutoPlaySelectedPlugins,
      preferredBingeGroup,
      preferBingeGroupInSelection: Boolean(preferredBingeGroup)
    });
    if (!selected?.id) {
      if (allLoaded) {
        this.autoPlayAttempted = true;
      }
      return;
    }
    this.autoPlayAttempted = true;
    this.cancelAutoPlaySelectionWait();
    void this.playStream(selected.id);
  },

  cancelAutoPlaySelectionWait() {
    if (this.autoPlaySelectionWaitTimer) {
      clearTimeout(this.autoPlaySelectionWaitTimer);
      this.autoPlaySelectionWaitTimer = null;
    }
  },

  startAutoPlayCountdown(stream, seconds) {
    this.cancelAutoPlayCountdown();
    // Focus the chosen stream so cancelling leaves the user on it.
    const visible = this.getFilteredStreams();
    const idx = visible.findIndex((entry) => String(entry?.id || "") === String(stream.id || ""));
    if (idx >= 0) {
      this.focusState = { zone: "card", index: idx, row: idx, action: "play" };
    }
    const total = Math.max(0, Math.trunc(Number(seconds) || 0));
    if (total <= 0) {
      void this.playStream(stream.id);
      return;
    }
    this.autoPlayCountdown = {
      streamId: stream.id,
      label: getStreamHeadline(stream) || stream.addonName || "stream",
      secondsLeft: total
    };
    this.requestRender({ delayMs: 0 });
    this.autoPlayTimer = setInterval(() => {
      if (!this.autoPlayCountdown) {
        return;
      }
      this.autoPlayCountdown.secondsLeft -= 1;
      if (this.autoPlayCountdown.secondsLeft <= 0) {
        const targetId = this.autoPlayCountdown.streamId;
        this.cancelAutoPlayCountdown();
        void this.playStream(targetId);
        return;
      }
      this.requestRender({ delayMs: 0 });
    }, 1000);
  },

  cancelAutoPlayCountdown() {
    if (this.autoPlayTimer) {
      clearInterval(this.autoPlayTimer);
      this.autoPlayTimer = null;
    }
    if (this.autoPlayCountdown) {
      this.autoPlayCountdown = null;
      this.requestRender({ delayMs: 0 });
    }
  },

  renderAutoPlayOverlay() {
    if (!this.autoPlayCountdown) {
      return "";
    }
    const { label, secondsLeft } = this.autoPlayCountdown;
    return `
      <div class="stream-route-autoplay">
        <div class="stream-route-autoplay-card">
          <div class="stream-route-autoplay-title">${escapeHtml(t("stream_autoplay_title", {}, "Auto-playing"))}</div>
          <div class="stream-route-autoplay-name">${escapeHtml(label)}</div>
          <div class="stream-route-autoplay-count">${escapeHtml(t("stream_autoplay_countdown", [secondsLeft], `Starting in ${secondsLeft}s`))}</div>
          <div class="stream-route-autoplay-hint">${escapeHtml(t("stream_autoplay_hint", {}, "Press OK to play now, or any key to choose manually"))}</div>
        </div>
      </div>`;
  },

  renderContinueWatchingResumeOverlay() {
    if (!this.autoResumeUiActive) {
      return "";
    }
    const title = String(
      this.params?.episodeTitle || this.params?.itemTitle || this.params?.playerTitle || ""
    ).trim();
    return `
      <div class="stream-route-autoplay">
        <div class="stream-route-autoplay-card">
          <div class="stream-route-autoplay-title">${escapeHtml(
            t("stream_finding_source", {}, "Finding stream source")
          )}</div>
          ${title ? `<div class="stream-route-autoplay-name">${escapeHtml(title)}</div>` : ""}
        </div>
      </div>`;
  },

  scheduleErrorChipCleanup() {
    if (this.errorChipTimer) {
      clearTimeout(this.errorChipTimer);
      this.errorChipTimer = null;
    }
    if (!this.sourceChips.some((chip) => chip.status === "error")) {
      return;
    }
    this.errorChipTimer = setTimeout(() => {
      this.sourceChips = this.sourceChips.filter((chip) => chip.status !== "error");
      this.requestRender();
    }, 1600);
  },

  getOrderedFilterNames() {
    return getOrderedFilterNames(this.sourceChips, this.streams);
  },

  // Two full sorts of the stream array. This runs on every badge-hydration pass,
  // i.e. every scroll frame, so memoise it against the source identities. Both
  // arrays are always reassigned rather than mutated in place, and render()
  // drops the cache so settings changes are picked up.
  getFilteredStreams(filter = this.addonFilter) {
    const cached = this.filteredStreamsCache;
    if (
      cached &&
      cached.streams === this.streams &&
      cached.sourceChips === this.sourceChips &&
      cached.filter === filter
    ) {
      return cached.result;
    }
    const orderedStreams = sortStreamsByAddonOrder(this.streams, this.sourceChips);
    const result =
      filter === "all"
        ? DebridStreamPresentation.sortForDisplay(orderedStreams, DebridSettingsStore.get())
        : orderedStreams.filter((stream) => stream.addonName === filter);
    this.filteredStreamsCache = {
      streams: this.streams,
      sourceChips: this.sourceChips,
      filter,
      result
    };
    return result;
  },

  hasPendingSourceLoads(filter = this.addonFilter) {
    if (!Array.isArray(this.sourceChips) || !this.sourceChips.length) {
      return Boolean(this.loading);
    }
    if (filter === "all") {
      return this.sourceChips.some((chip) => chip.status === "loading");
    }
    return this.sourceChips.some((chip) => chip.name === filter && chip.status === "loading");
  },

  setAddonFilter(nextFilter, preferredZone = "filter", preferredIndex = 0) {
    const targetFilter = String(nextFilter || "all");
    this.addonFilter = targetFilter;
    const filtered = this.getFilteredStreams(targetFilter);
    if (preferredZone === "card" && filtered.length) {
      this.focusState = {
        zone: "card",
        row: clamp(preferredIndex, 0, filtered.length - 1),
        action: "play"
      };
    } else {
      const ordered = ["all", ...this.getOrderedFilterNames()];
      this.focusState = {
        zone: "filter",
        index: clamp(ordered.indexOf(targetFilter), 0, Math.max(0, ordered.length - 1))
      };
    }
    this.listScrollTop = 0;
    this.render();
  },

  resolveCardActionForRow(row = null, preferredAction = "play") {
    if (!row) {
      return null;
    }
    if (preferredAction === "native" && row.native) {
      return row.native;
    }
    return row.play || row.native || null;
  },

  // One querySelectorAll plus two scoped queries per row. On a few hundred
  // sources that is a few hundred DOM queries per keypress, so hold the result
  // until the next render replaces the markup. Keyed by the absolute row index
  // from data-stream-row, which stays stable when only a window is rendered.
  getCardRows() {
    const cached = this.cardRowsCache;
    if (cached && this.container?.contains(cached.anchor)) {
      return cached.byIndex;
    }
    const byIndex = new Map();
    let anchor = null;
    Array.from(
      this.container?.querySelectorAll(".stream-route-card-row[data-stream-row]") || []
    ).forEach((rowNode) => {
      const entry = {
        row: Number(rowNode.dataset.streamRow || 0),
        node: rowNode,
        play: rowNode.querySelector('[data-card-action="play"]'),
        native: rowNode.querySelector('[data-card-action="native"]')
      };
      if (!entry.play && !entry.native) {
        return;
      }
      byIndex.set(entry.row, entry);
      anchor = anchor || rowNode;
    });
    this.cardRowsCache = anchor ? { byIndex, anchor } : null;
    return byIndex;
  },

  getCardRow(index) {
    return this.getCardRows().get(Number(index)) || null;
  },

  // The authoritative row count is the stream list, not the DOM, because the DOM
  // only holds a window of it.
  getVisibleStreamCount() {
    return this.getFilteredStreams().length;
  },

  isVirtualListEnabled() {
    return Environment.isWebOS() && this.getVisibleStreamCount() >= WEBOS_VIRTUAL_LIST_MIN_ROWS;
  },

  getRowHeight(index) {
    const measured = this.rowHeights?.[index];
    return measured > 0 ? measured : estimateRowHeight(this.rowHeights || []);
  },

  ensureRowOffsets(total) {
    const count = Math.max(0, Number(total || 0));
    if (!this.rowOffsets || this.rowOffsets.length !== count + 1) {
      this.rowOffsets = buildRowOffsets(
        this.rowHeights || [],
        count,
        estimateRowHeight(this.rowHeights || [])
      );
    }
    return this.rowOffsets;
  },

  getRowOffset(index, total) {
    const offsets = this.ensureRowOffsets(total);
    return offsets[clamp(Number(index || 0), 0, offsets.length - 1)] || 0;
  },

  getListViewportHeight(listNode) {
    const measured = Number(listNode?.clientHeight || 0);
    if (measured > 0) {
      this.lastListViewportHeight = measured;
      return measured;
    }
    return Number(this.lastListViewportHeight || 0) || VIRTUAL_LIST_FALLBACK_VIEWPORT_PX;
  },

  computeVirtualRange(scrollTop, viewportHeight, total, focusRow) {
    return computeVirtualRange({
      offsets: this.ensureRowOffsets(total),
      scrollTop,
      viewportHeight,
      total,
      focusRow
    });
  },

  virtualRangeNeedsRefresh(range, total) {
    return virtualRangeNeedsRefresh({ current: this.virtualRange, next: range, total });
  },

  isCardActionFocused(rowIndex, action) {
    return (
      this.focusState?.zone === "card" &&
      Number(this.focusState?.row || 0) === Number(rowIndex) &&
      String(this.focusState?.action || "play") === String(action || "play")
    );
  },

  // Clearing the marker used to touch every .focusable in the list, which on a
  // few hundred cards is a few hundred style invalidations per D-pad step. Track
  // the focused node instead and only sweep when the pointer is stale (i.e. once
  // after each render, which rebuilds the list markup).
  clearFocusedMarker(nextTarget) {
    const previous = this.focusedNode;
    if (previous === nextTarget) {
      return;
    }
    if (previous && this.container?.contains(previous)) {
      previous.classList.remove("focused");
      return;
    }
    this.container?.querySelectorAll(".focused")?.forEach((node) => {
      if (node !== nextTarget) {
        node.classList.remove("focused");
      }
    });
  },

  focusElement(target) {
    if (!target) {
      return false;
    }
    this.clearFocusedMarker(target);
    this.focusedNode = target;
    target.classList.add("focused");
    const listNode = target.closest(".stream-route-list");
    try {
      target.focus({ preventScroll: true });
    } catch (_) {
      target.focus();
    }
    // webOS below Chromium 64 ignores preventScroll and natively scrolls the
    // list, which fights the manual transform. Snap the native offset back.
    if (
      listNode?.classList?.contains("manual-scroll") &&
      Number(listNode.scrollTop || 0) !== 0
    ) {
      try {
        listNode.scrollTop = 0;
      } catch (_) {
        // Manual transform stays authoritative.
      }
    }

    const chipTrack = target.closest(".stream-route-chip-track");
    if (chipTrack) {
      const left = target.offsetLeft;
      const right = left + target.offsetWidth;
      const viewLeft = chipTrack.scrollLeft;
      const viewRight = viewLeft + chipTrack.clientWidth;
      const pad = 24;
      if (right > viewRight - pad) {
        chipTrack.scrollLeft = Math.max(0, right - chipTrack.clientWidth + pad);
      } else if (left < viewLeft + pad) {
        chipTrack.scrollLeft = Math.max(0, left - pad);
      }
    }

    if (listNode) {
      const measured = this.ensureListItemVisible(listNode, target);
      this.listScrollTop = this.getListScrollTop(listNode);
      this.scheduleFocusedListItemVisibilityCheck(listNode, target, measured);
    }
    return true;
  },

  focusList(list, index) {
    if (!Array.isArray(list) || !list.length) {
      return false;
    }
    const targetIndex = clamp(index, 0, list.length - 1);
    const target = list[targetIndex];
    if (!target) {
      return false;
    }
    return this.focusElement(target);
  },

  isLegacyWebOsRoute() {
    return Boolean(
      document.documentElement?.classList?.contains("legacy-webos") ||
        document.body?.classList?.contains("legacy-webos")
    );
  },

  shouldUseManualListScroll(listNode) {
    if (!listNode || !Environment.isWebOS()) {
      return false;
    }
    return Number(listNode.scrollHeight || 0) > Number(listNode.clientHeight || 0);
  },

  getListScrollTop(listNode) {
    if (!listNode) {
      return 0;
    }
    if (listNode.classList?.contains("manual-scroll")) {
      return Number(listNode.dataset?.manualScrollTop || 0);
    }
    return Number(listNode.scrollTop || 0);
  },

  // The whole card list rides on a single wrapper so a manual scroll step is one
  // transform write instead of one per card. webOS 3.x has no CSS custom
  // properties, so the offset is applied inline rather than through a variable.
  getListTrack(listNode) {
    const track = listNode?.firstElementChild;
    return track?.classList?.contains("stream-route-list-track") ? track : null;
  },

  updateManualListScrollTransform(listNode, scrollTop) {
    if (!listNode) {
      return;
    }
    const normalized = Math.max(0, Number(scrollTop || 0));
    const transform = normalized > 0 ? `translateY(${-normalized}px)` : "";
    const track = this.getListTrack(listNode);
    if (track) {
      if (track.style.transform !== transform) {
        track.style.transform = transform;
      }
      return;
    }
    // Defensive fallback for markup rendered before the track wrapper existed.
    Array.from(listNode.children || []).forEach((child) => {
      if (child instanceof HTMLElement && child.style.transform !== transform) {
        child.style.transform = transform;
      }
    });
  },

  applyManualListScroll(listNode, scrollTop) {
    if (!listNode) {
      return;
    }
    const normalized = Math.max(0, Number(scrollTop || 0));
    if (!listNode.classList.contains("manual-scroll")) {
      listNode.classList.add("manual-scroll");
    }
    listNode.dataset.manualScrollTop = String(normalized);
    if (Number(listNode.scrollTop || 0) !== 0) {
      try {
        listNode.scrollTop = 0;
      } catch (_) {
        // Ignore webOS scrollTop assignment failures; the manual transform is authoritative.
      }
    }
    this.updateManualListScrollTransform(listNode, normalized);
    this.listScrollTop = normalized;
  },

  // maxScrollOverride exists because scrollHeight is not usable once the track
  // is transformed: Chromium's scrollable overflow includes transformed
  // descendants, so translating the track up shrinks scrollHeight toward
  // clientHeight and the ceiling collapses as you scroll. Callers that know the
  // real content height from the geometry model pass it in.
  setListScrollTop(listNode, nextScrollTop, maxScrollOverride = null) {
    if (!listNode) {
      return;
    }
    const maxScrollTop =
      Number(maxScrollOverride) >= 0
        ? Number(maxScrollOverride)
        : Math.max(
            0,
            Number(listNode.scrollHeight || 0) - Number(listNode.clientHeight || 0)
          );
    const normalized = clamp(Number(nextScrollTop || 0), 0, maxScrollTop);
    if (listNode.classList?.contains("manual-scroll")) {
      this.applyManualListScroll(listNode, normalized);
      return;
    }
    if (this.shouldUseManualListScroll(listNode)) {
      this.applyManualListScroll(listNode, normalized);
      return;
    }
    listNode.scrollTop = normalized;
    if (typeof listNode.scrollTo === "function") {
      try {
        listNode.scrollTo(0, normalized);
      } catch (_) {
        listNode.scrollTop = normalized;
      }
    }
    const applied = Number(listNode.scrollTop || 0);
    if (
      this.isLegacyWebOsRoute() &&
      maxScrollTop > 0 &&
      normalized > 0 &&
      Math.abs(applied - normalized) > 2
    ) {
      this.applyManualListScroll(listNode, normalized);
      return;
    }
    this.listScrollTop = Number(applied || normalized || 0);
  },

  // Total content height straight from the geometry model, plus the trailing
  // loader card when sources are still arriving. Independent of scrollHeight,
  // which is unreliable under the manual-scroll transform.
  getVirtualContentHeight(listNode, total) {
    let height = this.getRowOffset(total, total);
    const loader = listNode?.querySelector?.(
      ".stream-route-card-row:not([data-stream-row])"
    );
    if (loader) {
      height += Number(loader.offsetHeight || 0) + Number(this.rowGapPx || 0);
    }
    return height;
  },

  getVirtualMaxScroll(listNode, total, viewport) {
    return Math.max(0, this.getVirtualContentHeight(listNode, total) - viewport);
  },

  // Keeps the focused row pinned to whichever edge it is leaving, so holding a
  // direction scrolls the list underneath a focus marker that never leaves the
  // screen. All in model coordinates, which are exact for rendered rows.
  scrollVirtualRowIntoView(listNode, row) {
    const total = this.getVisibleStreamCount();
    if (!total) {
      return true;
    }
    const viewport = this.getListViewportHeight(listNode);
    const current = this.getListScrollTop(listNode);
    const maxScroll = this.getVirtualMaxScroll(listNode, total, viewport);
    const next = projectScrollForRow({
      offsets: this.ensureRowOffsets(total),
      row,
      scrollTop: current,
      viewportHeight: viewport,
      pad: WEBOS_VIRTUAL_VISIBILITY_PAD_PX,
      maxScroll
    });
    if (next !== current) {
      this.setListScrollTop(listNode, next, maxScroll);
    }
    return true;
  },

  ensureListItemVisible(listNode, target) {
    if (!listNode || !target) {
      return;
    }
    // Under virtualisation the model is the coordinate system the spacers are
    // built from, so use it rather than rects — mixing the two is what let the
    // scroll position and the model drift apart.
    if (this.isVirtualListEnabled()) {
      const row = Number(target.dataset?.streamRow ?? -1);
      if (row >= 0) {
        return this.scrollVirtualRowIntoView(listNode, row);
      }
    }
    const viewTop = this.getListScrollTop(listNode);
    let itemTop = Number(target.offsetTop || 0);
    let itemBottom = itemTop + Number(target.offsetHeight || 0);
    if (
      typeof listNode.getBoundingClientRect === "function" &&
      typeof target.getBoundingClientRect === "function"
    ) {
      const listRect = listNode.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      if (
        listRect &&
        targetRect &&
        Number.isFinite(targetRect.top) &&
        Number.isFinite(listRect.top)
      ) {
        itemTop = viewTop + (targetRect.top - listRect.top);
        itemBottom = viewTop + (targetRect.bottom - listRect.top);
      }
    }
    const viewHeight = Number(listNode.clientHeight || 0);
    if (!viewHeight) {
      return false;
    }
    const viewBottom = viewTop + viewHeight;
    const pad = 16;
    if (itemBottom > viewBottom - pad) {
      this.setListScrollTop(listNode, itemBottom - viewHeight + pad);
    } else if (itemTop < viewTop + pad) {
      this.setListScrollTop(listNode, itemTop - pad);
    }
    return true;
  },

  // Only re-measure when the first pass could not (the list had no box yet,
  // which happens on the render right after the route mounts). Re-running it
  // unconditionally cost a second forced layout of the whole list per keypress.
  scheduleFocusedListItemVisibilityCheck(listNode, target, measured = false) {
    if (!listNode || !target) {
      return;
    }
    const run = () => {
      const root = document.documentElement || document.body;
      if (!this.container || !root?.contains?.(listNode) || !root?.contains?.(target)) {
        return;
      }
      if (!measured) {
        this.ensureListItemVisible(listNode, target);
      }
      this.requestStreamBadgeHydration();
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(run);
      return;
    }
    setTimeout(run, 0);
  },

  getChipNodes() {
    const cached = this.chipNodesCache;
    if (cached?.length && this.container?.contains(cached[0])) {
      return cached;
    }
    const chips = Array.from(
      this.container?.querySelectorAll(".stream-route-chip.focusable") || []
    );
    this.chipNodesCache = chips;
    return chips;
  },

  // rowCount comes from the stream list rather than the DOM: under
  // virtualisation the DOM only holds a window, so DOM length is not the
  // navigable range and DOM position is not the row index.
  getFocusLists() {
    return {
      chips: this.getChipNodes(),
      rowCount: this.getCardRows().size ? this.getVisibleStreamCount() : 0
    };
  },

  applyFocus() {
    const { chips, rowCount } = this.getFocusLists();
    if (!chips.length && !rowCount) {
      return;
    }
    const zone = this.focusState?.zone || (rowCount ? "card" : "filter");
    const index = Number(this.focusState?.index || 0);
    if (zone === "card" && rowCount) {
      const rowIndex = clamp(Number(this.focusState?.row || 0), 0, rowCount - 1);
      const preferredAction = String(this.focusState?.action || "play");
      this.syncVirtualWindowForRow(rowIndex);
      let target = this.resolveCardActionForRow(this.getCardRow(rowIndex), preferredAction);
      if (!target) {
        // syncVirtualWindowForRow is supposed to guarantee the row is resident.
        // If it somehow is not, rebuild the window centred on it rather than
        // leaving the focus marker on a card that no longer exists — that is
        // what strands the list with nothing visibly focused.
        this.forceVirtualWindowOnRow(rowIndex);
        target = this.resolveCardActionForRow(this.getCardRow(rowIndex), preferredAction);
      }
      const resolvedAction = target?.dataset?.cardAction || "play";
      this.focusState = { zone: "card", row: rowIndex, action: resolvedAction };
      this.focusElement(target);
      return;
    }
    this.focusState = { zone: "filter", index: clamp(index, 0, Math.max(0, chips.length - 1)) };
    this.focusList(chips, this.focusState.index);
  },

  restoreScrollPosition() {
    const list = this.container?.querySelector(".stream-route-list");
    if (!list) {
      return;
    }
    const max = this.isVirtualListEnabled()
      ? this.getVirtualMaxScroll(
          list,
          this.getVisibleStreamCount(),
          this.getListViewportHeight(list)
        )
      : null;
    this.setListScrollTop(list, Number(this.listScrollTop || 0), max);
  },

  getHeaderMeta() {
    const isSeries = normalizeType(this.params?.itemType) === "series";
    const title = String(this.params?.itemTitle || this.params?.playerTitle || "Untitled");
    const subtitle = isSeries
      ? String(this.params?.episodeTitle || this.params?.playerSubtitle || "").trim()
      : String(this.params?.itemSubtitle || "").trim();
    const episodeLabel = normalizeEpisodeCode(this.params?.season, this.params?.episode);
    const detailLine = isSeries
      ? ""
      : [String(this.params?.genres || "").trim(), String(this.params?.year || "").trim()]
          .filter(Boolean)
          .join(" • ");
    return { isSeries, title, subtitle, episodeLabel, detailLine };
  },

  async detectWebOsNativePlayerApp() {
    if (!Environment.isWebOS() || !WebOsLunaService.isAvailable()) {
      this.webOsNativePlayerAppId = "";
      return "";
    }
    const requestToken = Number(this.nativePlayerRequestToken || 0) + 1;
    this.nativePlayerRequestToken = requestToken;
    for (const appId of WEBOS_NATIVE_PLAYER_APP_IDS) {
      try {
        const payload = await WebOsLunaService.request("luna://com.webos.applicationManager", {
          method: "getAppLoadStatus",
          parameters: { appId }
        });
        if (payload?.exist) {
          if (this.nativePlayerRequestToken === requestToken) {
            this.webOsNativePlayerAppId = appId;
            this.requestRender({ delayMs: 0 });
          }
          return appId;
        }
      } catch (_) {
        // Continue trying known native-player app ids.
      }
    }
    if (this.nativePlayerRequestToken === requestToken) {
      this.webOsNativePlayerAppId = "";
      this.requestRender({ delayMs: 0 });
    }
    return "";
  },

  showStreamToast(message) {
    if (!this.container) {
      return;
    }
    const shell = this.container.querySelector(".stream-route-shell");
    if (!shell) {
      return;
    }
    let toast = shell.querySelector(".stream-route-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "stream-route-toast";
      shell.appendChild(toast);
    }
    toast.textContent = String(message || "").trim();
    toast.classList.add("visible");
    if (this.streamToastTimer) {
      clearTimeout(this.streamToastTimer);
    }
    this.streamToastTimer = setTimeout(() => {
      toast?.classList.remove("visible");
    }, 2600);
  },

  getStreamRequestHeaders(stream = {}) {
    const raw = stream?.raw || stream || {};
    const requestHeaders =
      raw?.behaviorHints?.proxyHeaders?.request || stream?.behaviorHints?.proxyHeaders?.request;
    return requestHeaders && typeof requestHeaders === "object" ? { ...requestHeaders } : {};
  },

  resolveStreamMimeType(stream = {}, fallbackUrl = "") {
    const raw = stream?.raw || stream || {};
    const candidates = [
      stream?.mimeType,
      raw?.mimeType,
      stream?.sourceType,
      raw?.sourceType,
      raw?.type,
      raw?.source
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    const explicit = candidates.find((value) => value.includes("/"));
    if (explicit) {
      return explicit;
    }
    const alias = String(candidates[0] || "").toLowerCase();
    const aliasMap = {
      dash: "application/dash+xml",
      hls: "application/vnd.apple.mpegurl",
      m3u8: "application/vnd.apple.mpegurl",
      m4v: "video/mp4",
      mkv: "video/x-matroska",
      mov: "video/quicktime",
      mp4: "video/mp4",
      mpd: "application/dash+xml",
      ts: "video/mp2t",
      webm: "video/webm"
    };
    return aliasMap[alias] || guessMimeTypeFromUrl(fallbackUrl) || "video/mp4";
  },

  getWebOsNativeLaunchUrl(stream = {}) {
    const requestHeaders = this.getStreamRequestHeaders(stream);
    if (Object.keys(requestHeaders).length) {
      return "";
    }
    const candidates = [
      stream?.engineFs?.publicPlaybackUrl,
      stream?.raw?.engineFs?.publicPlaybackUrl,
      stream?.externalUrl,
      stream?.url,
      stream?.raw?.externalUrl,
      stream?.raw?.url
    ].filter(Boolean);
    return (
      candidates.find(
        (value) => isLaunchableExternalMediaUrl(value) && !isLocalOnlyPlaybackUrl(value)
      ) || ""
    );
  },

  canOfferNativePlayerForStream(stream = {}) {
    if (!Environment.isWebOS() || !this.webOsNativePlayerAppId) {
      return false;
    }
    if (this.getWebOsNativeLaunchUrl(stream)) {
      return true;
    }
    if (WebOsEngineFsResolver.canResolveStream(stream)) {
      return true;
    }
    return DirectDebridResolver.canResolveStream(stream, {
      season: this.params?.season ?? null,
      episode: this.params?.episode ?? null
    });
  },

  replaceStreamInList(streamId, nextStream = null) {
    if (!streamId || !nextStream) {
      return;
    }
    this.streams = this.streams.map((stream) =>
      stream.id === streamId ? { ...stream, ...nextStream } : stream
    );
  },

  async resolveStreamForNativePlayer(stream = {}) {
    const directUrl = this.getWebOsNativeLaunchUrl(stream);
    if (directUrl) {
      return { status: "success", stream };
    }
    if (WebOsEngineFsResolver.canResolveStream(stream)) {
      const result = await WebOsEngineFsResolver.resolve(stream, {});
      if (result?.status === "success" && result.stream) {
        return result;
      }
    }
    if (
      DirectDebridResolver.canResolveStream(stream, {
        season: this.params?.season ?? null,
        episode: this.params?.episode ?? null
      })
    ) {
      const result = await DirectDebridResolver.resolve(stream, {
        season: this.params?.season ?? null,
        episode: this.params?.episode ?? null
      });
      if (result?.status === "success" && result.stream) {
        return result;
      }
      return result || { status: "unavailable" };
    }
    return { status: "unavailable" };
  },

  buildWebOsNativePlayerLaunchParameters(stream = {}) {
    const appId = String(this.webOsNativePlayerAppId || "").trim();
    const launchUrl = this.getWebOsNativeLaunchUrl(stream);
    if (!appId || !launchUrl) {
      return null;
    }
    const filename = normalizeExternalLaunchFileName(
      stream?.behaviorHints?.filename ||
        stream?.raw?.behaviorHints?.filename ||
        stream?.title ||
        stream?.name ||
        this.params?.itemTitle ||
        this.params?.playerTitle
    );
    const mimeType = this.resolveStreamMimeType(stream, launchUrl);
    return {
      id: appId,
      params: {
        payload: [
          {
            fullPath: launchUrl,
            artist: "",
            subtitle: "",
            dlnaInfo: {
              flagVal: 4096,
              cleartextSize: "-1",
              contentLength: "-1",
              opVal: 1,
              protocolInfo: buildWebOsDlnaProtocolInfo(mimeType),
              duration: 0
            },
            mediaType: "VIDEO",
            thumbnail: "",
            deviceType: "DMR",
            album: "",
            fileName: filename,
            lastPlayPosition: -1
          }
        ]
      }
    };
  },

  async openStreamInNativePlayer(streamId) {
    if (!Environment.isWebOS() || !this.webOsNativePlayerAppId || !WebOsLunaService.isAvailable()) {
      return;
    }
    if (this.nativePlayerPendingStreamId) {
      return;
    }
    const selected =
      this.getFilteredStreams().find((stream) => stream.id === streamId) ||
      this.streams.find((stream) => stream.id === streamId) ||
      null;
    if (!selected) {
      return;
    }

    this.nativePlayerPendingStreamId = streamId;
    this.requestRender({ delayMs: 0 });
    try {
      const result = await this.resolveStreamForNativePlayer(selected);
      if (result?.status !== "success" || !result.stream) {
        this.showStreamToast(
          t(
            "player_external_launch_unavailable",
            {},
            "This stream cannot be opened in Native Player"
          )
        );
        return;
      }

      this.replaceStreamInList(streamId, result.stream);
      const launchParameters = this.buildWebOsNativePlayerLaunchParameters(result.stream);
      if (!launchParameters) {
        this.requestRender({ delayMs: 0 });
        this.showStreamToast(
          t(
            "player_external_launch_unavailable",
            {},
            "This stream cannot be opened in Native Player"
          )
        );
        return;
      }

      await WebOsLunaService.request("luna://com.webos.applicationManager", {
        method: "launch",
        parameters: launchParameters
      });
      this.showStreamToast(
        t("player_external_launching_media_player", {}, "Opening Native Player")
      );
    } catch (error) {
      console.warn("Failed to open stream in native player", { streamId, error });
      this.showStreamToast(t("player_external_launch_failed", {}, "Could not open Native Player"));
    } finally {
      this.nativePlayerPendingStreamId = "";
      this.requestRender({ delayMs: 0 });
    }
  },

  renderChip(name, selected, status) {
    const chipStatus = String(status || "success");
    const classes = [
      "stream-route-chip",
      "focusable",
      selected ? "selected" : "",
      chipStatus !== "success" ? chipStatus : ""
    ]
      .filter(Boolean)
      .join(" ");
    const spinner =
      chipStatus === "loading"
        ? renderLoadingIndicator({ className: "stream-route-chip-spinner" })
        : "";
    return `
      <button class="${classes}" data-action="setFilter" data-addon="${escapeHtml(name)}">
        ${spinner}
        <span>${escapeHtml(name === "all" ? t("common.all", {}, "All") : name)}</span>
      </button>
    `;
  },

  renderStreamCard(stream, index, streamBadgesEnabled = true, badgeSettings = null) {
    const headline = getStreamHeadline(stream);
    const quality = getStreamQuality(stream);
    // Lazy badges exist to bound how many badge images live in the DOM. The
    // virtual list already bounds that to the rendered window, and hydrating
    // after a card is measured would change its height behind the geometry
    // model's back — which desynchronises the model from the real scroll
    // position. Render them inline whenever the window is doing the bounding.
    const lazyBadges =
      Environment.isWebOS() &&
      !this.isVirtualListEnabled() &&
      hasStreamBadges(stream, streamBadgesEnabled, badgeSettings);
    const badges = lazyBadges
      ? `<div class="stream-route-card-badges stream-route-card-badges-lazy" data-lazy-stream-badges data-stream-badge-row="${index}" data-badges-hydrated="false" aria-label="${escapeHtml(t("settings_stream_badges_section", {}, "Fusion Style"))}"></div>`
      : renderStreamBadges(stream, streamBadgesEnabled, badgeSettings);
    const showAddonLogo = badgeSettings?.showAddonLogo === true;
    const badgePlacement = resolveStreamBadgePlacement(badgeSettings);
    const topBadges = badgePlacement === "TOP" ? badges : "";
    const bottomBadges = badgePlacement === "BOTTOM" ? badges : "";
    const descriptionLines = getStreamDescriptionLines(stream);
    let addonIdentity = "";
    if (showAddonLogo) {
      const addonLogoUrl =
        normalizeAddonLogoUrl(stream.addonLogo) ||
        resolveAddonLogo(stream.addonName, this.addonLogoLookup);
      const cachedAddonLogoUrl = getCachedAddonLogoDisplayUrl(addonLogoUrl);
      let displayAddonLogoUrl = cachedAddonLogoUrl || "";
      if (addonLogoUrl && !displayAddonLogoUrl && !hasFailedAddonLogo(addonLogoUrl)) {
        requestAddonLogo(addonLogoUrl, () => this.requestRender({ delayMs: 160 }));
        if (Environment.isWebOS()) {
          displayAddonLogoUrl = getCachedAddonLogoDisplayUrl(addonLogoUrl);
        }
      }
      const addonBadgeLabel = escapeHtml(getAddonBadgeLabel(stream.addonName || ""));
      const addonLogoLoading = Environment.isWebOS() || Environment.isTizen() ? "eager" : "lazy";
      const addonLogoDecoding = Environment.isWebOS() || Environment.isTizen() ? "sync" : "async";
      const addonBadge = displayAddonLogoUrl
        ? `<img src="${escapeHtml(displayAddonLogoUrl)}" alt="${escapeHtml(stream.addonName || "Addon")}" data-addon-logo="${escapeHtml(addonLogoUrl)}" decoding="${addonLogoDecoding}" loading="${addonLogoLoading}" referrerpolicy="no-referrer" /><span hidden>${addonBadgeLabel}</span>`
        : `<span>${addonBadgeLabel}</span>`;
      addonIdentity = `
          <div class="stream-route-card-side">
            <div class="stream-route-addon-badge">${addonBadge}</div>
            <div class="stream-route-addon-name">${escapeHtml(stream.addonName || "Addon")}</div>
          </div>`;
    }

    return `
      <div class="stream-route-card-row" data-stream-row="${index}">
        <article class="stream-route-card stream-route-card-action focusable${this.isCardActionFocused(index, "play") ? " focused" : ""}"
                 data-action="playStream"
                 data-card-action="play"
                 data-stream-id="${escapeHtml(stream.id)}"
                 data-stream-row="${index}">
          <div class="stream-route-card-copy">
            <div class="stream-route-card-heading">${escapeHtml(headline)}</div>
            ${topBadges || ""}
            ${!badges ? `<div class="stream-route-card-quality">${escapeHtml(quality)}</div>` : ""}
            ${descriptionLines.map((line, lineIndex) => `<div class="stream-route-card-line${lineIndex > 0 ? " secondary" : ""}">${escapeHtml(line)}</div>`).join("")}
            ${bottomBadges || ""}
          </div>
          ${addonIdentity}
        </article>
      </div>
    `;
  },

  isRowRendered(index) {
    return this.getCardRows().has(Number(index));
  },

  resetVirtualGeometry() {
    this.rowHeights = [];
    this.rowOffsets = null;
    this.rowGapPx = 0;
    this.virtualRange = null;
  },

  // Row heights are indexed by position in the filtered list, so they have to be
  // dropped when that list is refiltered or reordered. Length plus the ids at
  // both ends is enough to catch every case that matters; a reorder that keeps
  // all three is absorbed by the spacer anchoring anyway.
  syncVirtualGeometryKey(filtered = []) {
    const key = [
      this.addonFilter,
      filtered.length,
      filtered[0]?.id || "",
      filtered[filtered.length - 1]?.id || ""
    ].join("|");
    if (this.virtualGeometryKey !== key) {
      this.virtualGeometryKey = key;
      this.resetVirtualGeometry();
    }
  },

  renderVirtualSpacer(position, height) {
    const px = Math.max(0, Math.round(Number(height || 0)));
    return `<div class="stream-route-virtual-spacer" data-virtual-spacer="${position}" style="height:${px}px"></div>`;
  },

  renderCardWindow(filtered, range, streamBadgesEnabled, badgeSettings) {
    const total = filtered.length;
    if (!total || range.end < range.start) {
      return "";
    }
    const start = clamp(Number(range.start || 0), 0, Math.max(0, total - 1));
    const end = clamp(Number(range.end ?? start), start, Math.max(0, total - 1));
    const cards = [];
    for (let index = start; index <= end; index += 1) {
      cards.push(
        this.renderStreamCard(filtered[index], index, streamBadgesEnabled, badgeSettings)
      );
    }
    const topHeight = this.getRowOffset(start, total);
    const bottomHeight = this.getRowOffset(total, total) - this.getRowOffset(end + 1, total);
    return (
      this.renderVirtualSpacer("top", topHeight) +
      cards.join("") +
      this.renderVirtualSpacer("bottom", bottomHeight)
    );
  },

  applyVirtualSpacerHeights(track, range, total) {
    const top = track?.querySelector('[data-virtual-spacer="top"]');
    const bottom = track?.querySelector('[data-virtual-spacer="bottom"]');
    if (top) {
      top.style.height = `${Math.max(0, Math.round(this.getRowOffset(range.start, total)))}px`;
    }
    if (bottom) {
      const height = this.getRowOffset(total, total) - this.getRowOffset(range.end + 1, total);
      bottom.style.height = `${Math.max(0, Math.round(height))}px`;
    }
  },

  // offsetTop deltas between consecutive rows give the true stride (box plus
  // margin) without reading computed styles, which would cost a style resolve
  // per row on webOS.
  measureRenderedRows() {
    const byIndex = this.getCardRows();
    if (!byIndex.size) {
      return false;
    }
    const measurements = [];
    byIndex.forEach((entry) => {
      measurements.push({
        row: entry.row,
        top: Number(entry.node.offsetTop || 0),
        height: Number(entry.node.offsetHeight || 0)
      });
    });
    const { strides, gap } = deriveRowStrides(measurements, this.rowGapPx);
    this.rowGapPx = gap;
    let changed = false;
    strides.forEach((stride, row) => {
      if (Math.abs(Number(this.rowHeights[row] || 0) - stride) > 0.5) {
        this.rowHeights[row] = stride;
        changed = true;
      }
    });
    if (changed) {
      this.rowOffsets = null;
    }
    return changed;
  },

  getRowViewportTop(listNode, index) {
    if (!listNode || index === null || index === undefined) {
      return null;
    }
    const entry = this.getCardRow(index);
    if (!entry?.node) {
      return null;
    }
    return (
      entry.node.getBoundingClientRect().top - listNode.getBoundingClientRect().top
    );
  },

  findFirstRowInView(listNode) {
    const byIndex = this.getCardRows();
    if (!byIndex.size || !listNode) {
      return null;
    }
    const listTop = listNode.getBoundingClientRect().top;
    let best = null;
    let bestTop = Number.POSITIVE_INFINITY;
    byIndex.forEach((entry) => {
      const top = entry.node.getBoundingClientRect().top - listTop;
      if (top >= -1 && top < bestTop) {
        bestTop = top;
        best = entry.row;
      }
    });
    return best;
  },

  // Swaps the rendered window. Everything visible is pinned to anchorRow so an
  // inaccurate spacer estimate can never surface as a visible jump.
  renderVirtualRows(range, anchorRow = null) {
    const list = this.container?.querySelector(".stream-route-list");
    const track = this.getListTrack(list);
    if (!list || !track) {
      return false;
    }
    const filtered = this.getFilteredStreams();
    const anchorBefore = this.getRowViewportTop(list, anchorRow);

    track.innerHTML =
      this.renderCardWindow(
        filtered,
        range,
        DebridSettingsStore.get().streamBadgesEnabled !== false,
        StreamBadgeSettingsStore.snapshot()
      ) + (this.hasPendingSourceLoads() ? this.renderLoadingCards(1) : "");

    this.virtualRange = { start: range.start, end: range.end };
    this.cardRowsCache = null;
    this.focusedNode = null;
    ScreenUtils.indexFocusables(this.container);
    this.measureRenderedRows();
    this.applyVirtualSpacerHeights(track, this.virtualRange, filtered.length);

    const anchorAfter = this.getRowViewportTop(list, anchorRow);
    if (anchorBefore !== null && anchorAfter !== null) {
      const delta = anchorAfter - anchorBefore;
      if (Math.abs(delta) > 0.5) {
        this.setListScrollTop(
          list,
          this.getListScrollTop(list) + delta,
          this.getVirtualMaxScroll(list, filtered.length, this.getListViewportHeight(list))
        );
      }
    }
    this.hydrateVisibleStreamBadges();
    return true;
  },

  // The window rendered inline by render() still has estimate-sized spacers.
  // Measure it once so the first D-pad step already works off real geometry.
  measureInitialVirtualRows() {
    if (!this.virtualRange) {
      return;
    }
    const list = this.container?.querySelector(".stream-route-list");
    const track = this.getListTrack(list);
    if (!track) {
      return;
    }
    const anchorBefore = this.getRowViewportTop(list, this.virtualRange.start);
    if (!this.measureRenderedRows()) {
      return;
    }
    this.applyVirtualSpacerHeights(track, this.virtualRange, this.getVisibleStreamCount());
    const anchorAfter = this.getRowViewportTop(list, this.virtualRange.start);
    if (anchorBefore !== null && anchorAfter !== null) {
      const delta = anchorAfter - anchorBefore;
      if (Math.abs(delta) > 0.5) {
        const total = this.getVisibleStreamCount();
        this.setListScrollTop(
          list,
          this.getListScrollTop(list) + delta,
          this.getVirtualMaxScroll(list, total, this.getListViewportHeight(list))
        );
      }
    }
  },

  // Where the list will end up scrolled once this row is focused. Measured rects
  // are preferred over the geometry model whenever the row is already rendered:
  // ensureListItemVisible does the actual scrolling from rects, so deriving the
  // window from the model instead would let the two drift apart and then feed
  // that drift back into the next window.
  getProjectedScrollForRow(listNode, focus, total, viewport) {
    return projectScrollForRow({
      offsets: this.ensureRowOffsets(total),
      row: focus,
      scrollTop: this.getListScrollTop(listNode),
      viewportHeight: viewport,
      pad: WEBOS_VIRTUAL_VISIBILITY_PAD_PX,
      maxScroll: this.getVirtualMaxScroll(listNode, total, viewport)
    });
  },

  // Called before focusing a row: makes sure that row exists in the DOM. The
  // model offsets only choose the window here — focusElement then scrolls using
  // real rects, so an estimate being wrong costs nothing.
  syncVirtualWindowForRow(rowIndex) {
    if (!this.isVirtualListEnabled()) {
      return;
    }
    const list = this.container?.querySelector(".stream-route-list");
    if (!list) {
      return;
    }
    const total = this.getVisibleStreamCount();
    if (!total) {
      return;
    }
    const focus = clamp(Number(rowIndex || 0), 0, total - 1);
    const viewport = this.getListViewportHeight(list);
    const projected = this.getProjectedScrollForRow(list, focus, total, viewport);
    const range = this.computeVirtualRange(projected, viewport, total, focus);
    if (this.virtualRangeNeedsRefresh(range, total)) {
      this.renderVirtualRows(range, this.isRowRendered(focus) ? focus : null);
    }
  },

  // Last-resort recovery: put the window on this row no matter what the current
  // scroll offset or geometry model say.
  forceVirtualWindowOnRow(rowIndex) {
    if (!this.isVirtualListEnabled()) {
      return;
    }
    const list = this.container?.querySelector(".stream-route-list");
    const total = this.getVisibleStreamCount();
    if (!list || !total) {
      return;
    }
    const viewport = this.getListViewportHeight(list);
    const focus = clamp(Number(rowIndex || 0), 0, total - 1);
    this.renderVirtualRows(
      this.computeVirtualRange(this.getRowOffset(focus, total), viewport, total, focus),
      null
    );
  },

  // Pointer and wheel scrolling drive the window directly. Focus is deliberately
  // not re-applied, so scrolling away from the focused card does not yank the
  // list back to it.
  syncVirtualWindowForScroll(listNode) {
    if (!this.isVirtualListEnabled() || !listNode) {
      return;
    }
    const total = this.getVisibleStreamCount();
    if (!total) {
      return;
    }
    // No focus row is pinned here on purpose: pinning it would stretch the
    // window from the focused card all the way to wherever the user scrolled.
    // The next D-pad press goes through syncVirtualWindowForRow, which brings
    // the focused row back before anything tries to focus it.
    const range = this.computeVirtualRange(
      this.getListScrollTop(listNode),
      this.getListViewportHeight(listNode),
      total,
      null
    );
    if (!this.virtualRangeNeedsRefresh(range, total)) {
      return;
    }
    this.renderVirtualRows(range, this.findFirstRowInView(listNode));
  },

  renderLoadingCards(count = 3) {
    return `
      <div class="stream-route-card-row">
        <div class="stream-route-card skeleton">
          <div class="stream-route-card-copy">
            <div class="stream-route-skeleton-line"></div>
            <div class="stream-route-skeleton-line"></div>
            <div class="stream-route-skeleton-line"></div>
            <div class="stream-route-skeleton-line"></div>
          </div>
        </div>
      </div>
    `.repeat(count);
  },

  render() {
    this.cancelScheduledRender();
    this.invalidateStreamRouteCaches();
    const { isSeries, title, subtitle, episodeLabel, detailLine } = this.getHeaderMeta();
    const backdrop = this.getBackdropUrl();
    const logo = this.params?.logo || "";
    const shellStableClass = this.hasRenderedStreamRouteShell ? " stable" : "";
    const orderedFilters = this.getOrderedFilterNames();
    const chips = [
      this.renderChip("all", this.addonFilter === "all", "success"),
      ...orderedFilters.map((name) => {
        const chip = this.sourceChips.find((entry) => entry.name === name) || {
          name,
          status: "success"
        };
        return this.renderChip(name, this.addonFilter === name, chip.status);
      })
    ].join("");
    const filtered = this.getFilteredStreams();
    const hasPendingForFilter = this.hasPendingSourceLoads();
    const hasAnyStreams = this.streams.length > 0;
    const streamBadgesEnabled = DebridSettingsStore.get().streamBadgesEnabled !== false;
    const badgeSettings = StreamBadgeSettingsStore.snapshot();
    const showAddonLogo = badgeSettings.showAddonLogo === true;
    const addonLogosReady = !showAddonLogo || !filtered.length || this.areAddonLogosReady(filtered);

    this.syncVirtualGeometryKey(filtered);
    this.virtualRange = null;

    let body = "";
    if (filtered.length && addonLogosReady) {
      if (this.isVirtualListEnabled()) {
        // The list box does not exist yet, so seed the window from the last known
        // viewport and the restored scroll offset. applyFocus() re-derives it
        // against the real box immediately after this markup lands.
        const range = this.computeVirtualRange(
          Number(this.listScrollTop || 0),
          this.getListViewportHeight(null),
          filtered.length,
          this.focusState?.zone === "card" ? Number(this.focusState?.row || 0) : null
        );
        this.virtualRange = { start: range.start, end: range.end };
        body = this.renderCardWindow(filtered, range, streamBadgesEnabled, badgeSettings);
      } else {
        this.virtualRange = null;
        body = filtered
          .map((stream, index) =>
            this.renderStreamCard(stream, index, streamBadgesEnabled, badgeSettings)
          )
          .join("");
      }
      if (hasPendingForFilter) {
        body += this.renderLoadingCards(1);
      }
    } else if (filtered.length && showAddonLogo) {
      this.requestAddonLogoPrerender(filtered);
      body = this.renderLoadingCards(Math.min(3, filtered.length));
    } else if ((this.loading && !hasAnyStreams) || hasPendingForFilter) {
      body = this.renderLoadingCards();
    } else if (this.error) {
      body = `<div class="stream-route-empty">${escapeHtml(this.error)}</div>`;
    } else if (!filtered.length) {
      body = `<div class="stream-route-empty">No sources found for this filter.</div>`;
    }

    const routeContent = this.autoResumeUiActive
      ? ""
      : `
        <div class="stream-route-content">
          <section class="stream-route-left">
            <div class="stream-route-left-inner">
              ${logo ? `<img src="${logo}" class="stream-route-logo" alt="${escapeHtml(title)}" />` : `<h1 class="stream-route-title">${escapeHtml(title)}</h1>`}
              ${episodeLabel ? `<div class="stream-route-episode-code">${escapeHtml(episodeLabel)}</div>` : ""}
              ${subtitle ? `<div class="stream-route-subtitle">${escapeHtml(subtitle)}</div>` : ""}
              ${detailLine ? `<div class="stream-route-detail-line">${escapeHtml(detailLine)}</div>` : !isSeries && subtitle ? `<div class="stream-route-detail-line">${escapeHtml(subtitle)}</div>` : ""}
            </div>
          </section>
          <section class="stream-route-right">
            <div class="stream-route-chip-wrap">
              <div class="stream-route-chip-track">${chips}</div>
            </div>
            <div class="stream-route-panel-shell">
              <div class="stream-route-panel">
                <div class="stream-route-list"><div class="stream-route-list-track">${body}</div></div>
              </div>
            </div>
          </section>
        </div>`;

    this.container.innerHTML = `
      <div class="stream-route-shell${shellStableClass}">
        <div class="stream-route-backdrop"${backdrop ? ` style="background-image:url('${String(backdrop).replace(/'/g, "%27")}')"` : ""}></div>
        <div class="stream-route-backdrop-dim"></div>
        <div class="stream-route-left-gradient"></div>
        <div class="stream-route-right-gradient"></div>
        ${routeContent}
        ${this.renderContinueWatchingResumeOverlay()}
        ${this.renderAutoPlayOverlay()}
      </div>
    `;

    // Restore once, then measure. The second restore that used to sit after
    // indexFocusables only re-forced a whole-list layout.
    this.restoreScrollPosition();
    this.measureInitialVirtualRows();
    this.hydrateVisibleStreamBadges();
    this.bindAddonLogoFallbacks();
    ScreenUtils.indexFocusables(this.container);
    this.applyFocus();
    this.bindListScrollState();
    this.hasRenderedStreamRouteShell = true;
  },

  bindListScrollState() {
    const list = this.container?.querySelector(".stream-route-list");
    if (!list) {
      return;
    }
    list.addEventListener(
      "scroll",
      () => {
        this.listScrollTop = this.getListScrollTop(list);
        this.syncVirtualWindowForScroll(list);
        this.requestStreamBadgeHydration();
      },
      { passive: true }
    );
    if (Environment.isWebOS()) {
      list.addEventListener(
        "wheel",
        (event) => {
          const deltaMode = Number(event?.deltaMode || 0);
          const multiplier = deltaMode === 1 ? 40 : deltaMode === 2 ? list.clientHeight : 1;
          const deltaY = Number(event?.deltaY || 0) * multiplier;
          if (!deltaY) {
            return;
          }
          event?.preventDefault?.();
          const max = this.isVirtualListEnabled()
            ? this.getVirtualMaxScroll(
                list,
                this.getVisibleStreamCount(),
                this.getListViewportHeight(list)
              )
            : null;
          this.setListScrollTop(list, this.getListScrollTop(list) + deltaY, max);
          // Manual scroll clips the list, so no scroll event fires to drive the
          // window; do it here.
          this.syncVirtualWindowForScroll(list);
          this.requestStreamBadgeHydration();
        },
        { passive: false }
      );
    }
  },

  requestStreamBadgeHydration() {
    if (
      !Environment.isWebOS() ||
      Router.getCurrent() !== "stream" ||
      this.streamBadgeHydrationFrame
    ) {
      return;
    }
    this.streamBadgeHydrationFrame = requestAnimationFrame(() => {
      this.streamBadgeHydrationFrame = null;
      this.hydrateVisibleStreamBadges();
    });
  },

  hydrateVisibleStreamBadges() {
    if (
      !Environment.isWebOS() ||
      Router.getCurrent() !== "stream" ||
      !this.container
    ) {
      return;
    }
    const list = this.container.querySelector(".stream-route-list");
    const placeholders = Array.from(
      this.container.querySelectorAll("[data-lazy-stream-badges]")
    );
    if (!list || !placeholders.length) {
      return;
    }
    const listRect = list.getBoundingClientRect();
    const overscan = Math.max(
      WEBOS_STREAM_BADGE_MIN_OVERSCAN_PX,
      Number(list.clientHeight || 0) * WEBOS_STREAM_BADGE_OVERSCAN_RATIO
    );
    const viewportTop = Number(listRect?.top || 0) - overscan;
    const viewportBottom = Number(listRect?.bottom || 0) + overscan;
    const focusedRow =
      this.focusState?.zone === "card" ? Number(this.focusState?.row || 0) : -1;

    // Android's LazyColumn only composes badge images near the viewport. Keep
    // the complete Web card list for existing remote/pointer navigation, but
    // apply the same bounded image/DOM lifetime on webOS.
    //
    // Measure every placeholder first, mutate afterwards. Interleaving the two
    // made each innerHTML write invalidate layout for the next rect read, so a
    // single D-pad step forced one full layout of the entire card list per
    // hydrated row.
    const pending = [];
    placeholders.forEach((placeholder) => {
      const rowIndex = Number(placeholder.dataset.streamBadgeRow || -1);
      const card = placeholder.closest(".stream-route-card-row");
      const cardRect = card?.getBoundingClientRect?.();
      const nearViewport = Boolean(
        cardRect &&
          Number(cardRect.bottom || 0) >= viewportTop &&
          Number(cardRect.top || 0) <= viewportBottom
      );
      const shouldHydrate = rowIndex === focusedRow || nearViewport;
      const hydrated = placeholder.dataset.badgesHydrated === "true";
      if (shouldHydrate !== hydrated) {
        pending.push({ placeholder, rowIndex, shouldHydrate });
      }
    });
    if (!pending.length) {
      return;
    }

    const filtered = this.getFilteredStreams();
    const streamBadgesEnabled = DebridSettingsStore.get().streamBadgesEnabled !== false;
    const badgeSettings = StreamBadgeSettingsStore.snapshot();
    pending.forEach(({ placeholder, rowIndex, shouldHydrate }) => {
      if (shouldHydrate) {
        placeholder.innerHTML = renderStreamBadgeContents(
          filtered[rowIndex],
          streamBadgesEnabled,
          badgeSettings
        );
        placeholder.dataset.badgesHydrated = "true";
        return;
      }
      placeholder.textContent = "";
      placeholder.dataset.badgesHydrated = "false";
    });
  },

  bindAddonLogoFallbacks() {
    this.container
      ?.querySelectorAll(".stream-route-addon-badge img[data-addon-logo]")
      .forEach((node) => {
        if (!(node instanceof HTMLImageElement) || node.dataset.fallbackBound === "true") {
          return;
        }
        node.dataset.fallbackBound = "true";
        const fallback = node.nextElementSibling;
        const applyFallback = () => {
          rememberFailedAddonLogo(node.dataset.addonLogo || node.getAttribute("src") || "");
          node.hidden = true;
          if (fallback instanceof HTMLElement) {
            fallback.hidden = false;
          }
        };
        node.addEventListener("error", applyFallback, { once: true });
      });
  },

  async playStream(streamId) {
    this.cancelAutoPlayCountdown();
    this.cancelAutoPlaySelectionWait();
    const filtered = this.getFilteredStreams();
    const selected = filtered.find((stream) => stream.id === streamId) || filtered[0];
    if (!selected) {
      return;
    }
    const playerStreamCandidates = this.getFilteredStreams();
    const itemType = normalizeType(this.params?.itemType);
    const startFromBeginning = Boolean(this.params?.startFromBeginning);
    const routeResumeProgress = {
      positionMs: Number(this.params?.resumePositionMs || 0) || 0,
      progressPercent: this.params?.resumeProgressPercent,
      durationMs: Number(this.params?.resumeDurationMs || 0) || 0
    };
    const hasRouteResume = !startFromBeginning && isWatchProgressInProgress(routeResumeProgress);
    let resumePositionMs = hasRouteResume ? routeResumeProgress.positionMs : 0;
    let resumeProgressPercent = hasRouteResume ? routeResumeProgress.progressPercent : null;
    let resumeDurationMs = hasRouteResume ? routeResumeProgress.durationMs : 0;
    if (!startFromBeginning && resumePositionMs <= 0 && !(Number(resumeProgressPercent) > 0)) {
      const resumeProgress = await watchProgressRepository
        .getResumeByContentId(this.params?.itemId, {
          videoId: this.params?.videoId || null,
          season: this.params?.season,
          episode: this.params?.episode
        })
        .catch((error) => {
          console.warn("Stream resume lookup failed", error);
          return null;
        });
      resumePositionMs = Number(resumeProgress?.positionMs || 0) || 0;
      resumeProgressPercent = resumeProgress?.progressPercent ?? resumeProgressPercent;
      resumeDurationMs = Number(resumeProgress?.durationMs || 0) || resumeDurationMs;
    }

    Router.navigate("player", {
      streamUrl: selected.url || selected.externalUrl || null,
      itemId: this.params?.itemId || null,
      itemType: itemType || "movie",
      imdbId: this.params?.imdbId || null,
      tmdbId: this.params?.tmdbId || this.params?.tmdb_id || null,
      traktId: this.params?.traktId || this.params?.trakt_id || null,
      contentLanguage:
        this.params?.contentLanguage ||
        this.params?.originalLanguage ||
        this.params?.original_language ||
        null,
      videoId: this.params?.videoId || null,
      resumePositionMs,
      resumeProgressPercent,
      resumeDurationMs,
      startFromBeginning,
      episodeLabel:
        this.params?.season && this.params?.episode
          ? `S${this.params.season}E${this.params.episode}`
          : null,
      playerTitle: this.params?.itemTitle || this.params?.playerTitle || "Untitled",
      playerSubtitle: this.params?.episodeTitle || this.params?.playerSubtitle || "",
      playerEpisodeTitle: this.params?.episodeTitle || "",
      playerReleaseYear: this.params?.year || "",
      playerBackdropUrl: this.getBackdropUrl() || null,
      playerLogoUrl: this.params?.logo || null,
      parentalWarnings: this.params?.parentalWarnings || null,
      parentalGuide: this.params?.parentalGuide || null,
      season: this.params?.season == null ? null : Number(this.params.season),
      episode: this.params?.episode == null ? null : Number(this.params.episode),
      episodes: Array.isArray(this.params?.episodes) ? this.params.episodes : [],
      streamCandidates: playerStreamCandidates,
      preferredStreamId: selected.id,
      playbackSourceContext: selected.streamOrigin || {
        addonId: selected.addonId || "",
        addonBaseUrl: selected.addonBaseUrl || "",
        addonName: selected.addonName || "",
        addonOrderIndex: Number.isFinite(Number(selected.addonOrderIndex))
          ? Number(selected.addonOrderIndex)
          : null,
        sourceProviderId: selected.sourceProviderId || "",
        sourceIds: Array.isArray(selected.sources) ? selected.sources : [],
        selectedStreamId: selected.id || ""
      },
      returnToStreamOnBack: true,
      streamRouteParams: this.params ? { ...this.params } : null,
      fromDetailRoute: Boolean(this.params?.fromDetailRoute),
      nextEpisodeVideoId: this.params?.nextEpisodeVideoId || null,
      nextEpisodeLabel: this.params?.nextEpisodeLabel || null,
      nextEpisodeSeason: this.params?.nextEpisodeSeason ?? null,
      nextEpisodeEpisode: this.params?.nextEpisodeEpisode ?? null,
      nextEpisodeTitle: this.params?.nextEpisodeTitle || "",
      nextEpisodeReleased: this.params?.nextEpisodeReleased || ""
    });
  },

  onPointerFocus(target) {
    if (!target || !this.container?.contains(target)) {
      return false;
    }
    const { chips } = this.getFocusLists();
    const chipTarget = target.closest?.(".stream-route-chip.focusable") || target;
    const chipIndex = chips.indexOf(chipTarget);
    if (chipIndex >= 0) {
      this.focusState = { zone: "filter", index: chipIndex };
      this.focusList(chips, chipIndex);
      return true;
    }
    const cardAction = target.closest?.("[data-stream-row][data-card-action]");
    if (cardAction) {
      this.focusState = {
        zone: "card",
        row: Math.max(0, Number(cardAction.dataset.streamRow || 0)),
        action: String(cardAction.dataset.cardAction || "play")
      };
      this.focusElement(cardAction);
      return true;
    }
    return false;
  },

  onPointerActivate(target) {
    if (!target || !this.container?.contains(target)) {
      return false;
    }
    const actionTarget = target.closest?.("[data-action]") || target;
    this.onPointerFocus(actionTarget);
    const action = String(actionTarget.dataset.action || "");
    if (action === "setFilter") {
      const addon = String(actionTarget.dataset.addon || "all");
      const { chips } = this.getFocusLists();
      this.setAddonFilter(addon, "filter", Math.max(0, chips.indexOf(actionTarget)));
      return true;
    }
    if (action === "playStream") {
      this.playStream(actionTarget.dataset.streamId);
      return true;
    }
    if (action === "openNativePlayer") {
      void this.openStreamInNativePlayer(actionTarget.dataset.streamId);
      return true;
    }
    return false;
  },

  onKeyDown(event) {
    // Any key during the auto-play countdown hands control back to the user.
    // Back just cancels and stays on the picker; other keys cancel and then do
    // their normal thing (OK on the highlighted stream plays it right away).
    if (this.autoPlayCountdown) {
      this.cancelAutoPlayCountdown();
      if (isBackEvent(event)) {
        event?.preventDefault?.();
        return;
      }
    }

    if (isBackEvent(event)) {
      event?.preventDefault?.();
      if (!this.navigateBackFromStream()) {
        Router.back();
      }
      return;
    }

    const direction = getDpadDirection(event);
    if (direction) {
      const { chips, rowCount } = this.getFocusLists();
      const zone = this.focusState?.zone || (rowCount ? "card" : "filter");
      let index = Number(this.focusState?.index || 0);
      event?.preventDefault?.();

      if (zone === "filter") {
        if (direction === "left") {
          if (chips.length) {
            const ordered = ["all", ...this.getOrderedFilterNames()];
            const currentFilter = ordered[clamp(index, 0, ordered.length - 1)] || "all";
            const currentPosition = ordered.indexOf(currentFilter);
            const nextFilter = ordered[clamp(currentPosition - 1, 0, ordered.length - 1)];
            this.setAddonFilter(
              nextFilter,
              "filter",
              clamp(index - 1, 0, Math.max(0, chips.length - 1))
            );
          }
          return;
        }
        if (direction === "right") {
          if (chips.length) {
            const ordered = ["all", ...this.getOrderedFilterNames()];
            const currentFilter = ordered[clamp(index, 0, ordered.length - 1)] || "all";
            const currentPosition = ordered.indexOf(currentFilter);
            const nextFilter = ordered[clamp(currentPosition + 1, 0, ordered.length - 1)];
            this.setAddonFilter(
              nextFilter,
              "filter",
              clamp(index + 1, 0, Math.max(0, chips.length - 1))
            );
          }
          return;
        }
        if (direction === "down" && rowCount) {
          this.focusState = { zone: "card", row: 0, action: "play" };
          this.applyFocus();
        }
        return;
      }

      if (zone === "card") {
        const rowIndex = clamp(Number(this.focusState?.row || 0), 0, Math.max(0, rowCount - 1));
        const currentRow = this.getCardRow(rowIndex);
        const currentAction = String(this.focusState?.action || "play");
        if (direction === "up") {
          if (rowIndex > 0) {
            // The target action is resolved in applyFocus(), once the row it
            // names is guaranteed to be inside the rendered window.
            this.focusState = {
              zone: "card",
              row: rowIndex - 1,
              action: currentAction
            };
            this.applyFocus();
            return;
          }
          this.focusState = {
            zone: "filter",
            index: clamp(
              ["all", ...this.getOrderedFilterNames()].indexOf(this.addonFilter),
              0,
              Math.max(0, chips.length - 1)
            )
          };
          this.applyFocus();
          return;
        }
        if (direction === "down") {
          this.focusState = {
            zone: "card",
            row: clamp(rowIndex + 1, 0, Math.max(0, rowCount - 1)),
            action: currentAction
          };
          this.applyFocus();
          return;
        }
        if (direction === "left") {
          if (currentAction === "native" && currentRow?.play) {
            this.focusState = { zone: "card", row: rowIndex, action: "play" };
            this.applyFocus();
            return;
          }
          const ordered = ["all", ...this.getOrderedFilterNames()];
          const currentIndex = Math.max(0, ordered.indexOf(this.addonFilter));
          const nextFilter = ordered[clamp(currentIndex - 1, 0, ordered.length - 1)] || "all";
          this.setAddonFilter(nextFilter, "card", rowIndex);
          return;
        }
        if (direction === "right") {
          if (currentAction === "play" && currentRow?.native) {
            this.focusState = { zone: "card", row: rowIndex, action: "native" };
            this.applyFocus();
            return;
          }
          const ordered = ["all", ...this.getOrderedFilterNames()];
          const currentIndex = Math.max(0, ordered.indexOf(this.addonFilter));
          const nextFilter = ordered[clamp(currentIndex + 1, 0, ordered.length - 1)] || "all";
          this.setAddonFilter(nextFilter, "card", rowIndex);
          return;
        }
      }
      return;
    }

    if (Number(event?.keyCode || 0) !== 13) {
      return;
    }

    const current = this.container.querySelector(".focusable.focused");
    if (!current) {
      return;
    }
    const action = String(current.dataset.action || "");
    if (action === "setFilter") {
      const addon = String(current.dataset.addon || "all");
      this.setAddonFilter(
        addon,
        "filter",
        Array.from(this.container.querySelectorAll(".stream-route-chip.focusable")).indexOf(current)
      );
      return;
    }
    if (action === "playStream") {
      this.playStream(current.dataset.streamId);
      return;
    }
    if (action === "openNativePlayer") {
      void this.openStreamInNativePlayer(current.dataset.streamId);
    }
  },

  cleanup() {
    this.cancelAutoPlayCountdown();
    this.cancelAutoPlaySelectionWait();
    this.loadToken = (this.loadToken || 0) + 1;
    this.playResolveToken = Number(this.playResolveToken || 0) + 1;
    this.nativePlayerRequestToken = Number(this.nativePlayerRequestToken || 0) + 1;
    this.cancelScheduledRender();
    if (this.errorChipTimer) {
      clearTimeout(this.errorChipTimer);
      this.errorChipTimer = null;
    }
    if (this.streamToastTimer) {
      clearTimeout(this.streamToastTimer);
      this.streamToastTimer = null;
    }
    if (this.releaseImageProxyReadyListener) {
      this.releaseImageProxyReadyListener();
      this.releaseImageProxyReadyListener = null;
    }
    ScreenUtils.hide(this.container);
  }
};
