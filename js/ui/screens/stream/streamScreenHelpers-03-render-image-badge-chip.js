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

import { orderSourceNames, orderStreamsByAddonOrder, groupStreamsByProvider } from "../../../core/streams/streamOrdering.js";

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

import { escapeHtml, STREAM_BADGE_LIMIT, t, formatBytes } from "./streamScreenHelpers-01-stream-badge-limit.js";

export function renderImageBadgeChip(badge = {}) {
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
      <img ${Environment.isWebOS() ? `data-cached-badge-image="${escapeHtml(imageUrl)}"` : `src="${escapeHtml(safeImageUrl)}"`} alt="${escapeHtml(badge.name || "")}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
    </span>
  `;
}

export function renderImportedStreamBadgeChipContents(stream = {}, badges = [], showFileSizeBadges = true) {
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

export function renderImportedStreamBadgeChips(stream = {}, badges = [], showFileSizeBadges = true) {
  const contents = renderImportedStreamBadgeChipContents(stream, badges, showFileSizeBadges);
  return contents
    ? `<div class="stream-route-card-badges" aria-label="${escapeHtml(t("settings_stream_badges_section", {}, "Fusion Style"))}">${contents}</div>`
    : "";
}

export function renderStreamBadges(stream = {}, enabled = true, badgeSettings = null) {
  if (!enabled) {
    return "";
  }
  const currentBadgeSettings = badgeSettings || StreamBadgeSettingsStore.snapshot();
  const importedBadges = matchStreamBadges(stream, currentBadgeSettings.rules);
  return renderImportedStreamBadgeChips(stream, importedBadges, currentBadgeSettings.showFileSizeBadges !== false);
}

export function hasStreamBadges(stream = {}, enabled = true, badgeSettings = null) {
  if (!enabled) {
    return false;
  }
  const currentBadgeSettings = badgeSettings || StreamBadgeSettingsStore.snapshot();
  if (currentBadgeSettings.showFileSizeBadges !== false && stream.behaviorHints?.videoSize != null) {
    return true;
  }
  return matchStreamBadges(stream, currentBadgeSettings.rules).some((badge) => normalizeAddonLogoUrl(badge.imageURL));
}

export function renderStreamBadgeContents(stream = {}, enabled = true, badgeSettings = null) {
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

export function resolveStreamBadgePlacement(badgeSettings = null) {
  const placement = String((badgeSettings || StreamBadgeSettingsStore.snapshot()).badgePlacement || "BOTTOM")
    .trim()
    .toUpperCase();
  return placement === "TOP" ? "TOP" : "BOTTOM";
}

export function getOrderedFilterNames(sourceChips = [], streams = []) {
  return orderSourceNames(streams, sourceChips, {
    isDirectDebrid: (stream) => DebridStreamPresentation.isDirectDebrid(stream)
  });
}

export function sortStreamsByAddonOrder(streams = [], sourceChips = []) {
  return groupStreamsByProvider(
    orderStreamsByAddonOrder(streams, sourceChips, {
      isDirectDebrid: (stream) => DebridStreamPresentation.isDirectDebrid(stream)
    })
  );
}
