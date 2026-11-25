import { applyTrailerCaptionParams } from "../../../core/detail/trailerCaptions.js";

import { Router } from "../../navigation/routerState.js";

import { ScreenUtils } from "../../navigation/screen.js";

import { metaRepository } from "../../../data/repository/metaRepository.js";

import { watchProgressRepository } from "../../../data/repository/watchProgressRepository.js";

import { savedLibraryRepository } from "../../../data/repository/savedLibraryRepository.js";

import { watchedItemsRepository } from "../../../data/repository/watchedItemsRepository.js";

import { watchedItemsShareIdentity } from "../../../data/repository/watchedIdentity.js";

import { watchedTitleStateRepository } from "../../../data/repository/watchedTitleStateRepository.js";

import { libraryRepository, LibrarySourceMode } from "../../../data/repository/libraryRepository.js";

import { detailWatchedEnrichmentService } from "../../../data/repository/detailWatchedEnrichmentService.js";

import { watchedSeriesReconciliationService } from "../../../data/repository/watchedSeriesReconciliationService.js";

import { TmdbService } from "../../../core/tmdb/tmdbService.js";

import { TmdbMetadataService } from "../../../core/tmdb/tmdbMetadataService.js";

import { normalizeTmdbBackdropUrl } from "../../../core/tmdb/tmdbImageUrl.js";

import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";

import { showHomeRatings, showStandardDetailRatings } from "../../../core/util/imdbRatingVisibility.js";

import { imdbEpisodeRatingsRepository } from "../../../data/repository/imdbEpisodeRatingsRepository.js";

import { formatHeroRuntime, normalizeEpisodeImdbRating, parseEpisodeRuntimeMinutes } from "./episodeCardMetadata.js";

import { mdbListRepository } from "../../../data/repository/mdbListRepository.js";

import { TmdbSettingsStore } from "../../../data/local/tmdbSettingsStore.js";

import { PlayerSettingsStore } from "../../../data/local/playerSettingsStore.js";

import { MoreLikeThisSourcePreference, TraktSettingsStore, WatchProgressSource } from "../../../data/local/traktSettingsStore.js";

import { requestJson as traktRequestJson, TraktAuthService } from "../../../data/repository/traktAuthService.js";

import { toTraktImageUrl } from "../../../core/trakt/traktImageUrl.js";

import { supportsMembershipFor } from "../../../core/tracking/trackingLibraryMembership.js";

import { Environment } from "../../../platform/environment.js";

import { Platform } from "../../../platform/index.js";

import { getTvRuntimePerformanceProfile } from "../../../platform/tvRuntimePerformance.js";

import { TMDB_API_KEY, TRAKT_API_URL, TRAKT_CLIENT_ID, YOUTUBE_PROXY_URL } from "../../../config.js";

import { I18n } from "../../../i18n/index.js";

import { localizedGenreLabel } from "../../../i18n/genreLabels.js";

import { contentTextDirection } from "../../../core/util/contentTextDirection.js";

import { mdbListRatingIcon } from "../../../core/util/mdbListRatingStatus.js";

import { NuvioDialog } from "../../components/nuvioDialog.js";

import { renderLoadingIndicator } from "../../components/loadingIndicator.js";

import { resolveMovieStreamIdentity } from "./movieStreamIdentity.js";

import { posterItemFromNode, PosterOptionsDialogController } from "../../components/posterOptionsMenu.js";

import { StreamPreferencesStore } from "../../../data/local/streamPreferencesStore.js";

import { buildWatchedTitleIdSet, isTitleItemWatched } from "../../components/watchedTitleBadge.js";

import {
  getWatchProgressFraction,
  isWatchProgressCompleted,
  isWatchProgressInProgress,
  watchProgressCompletedThreshold,
  resolveWatchProgressResumePositionMs
} from "../../../domain/model/watchProgress.js";

import { getAddonIconPath } from "./metaDetailsScreenHelpers-04-detect-quality.js";
import { t, LOCAL_YOUTUBE_PROXY_URL } from "./metaDetailsScreenHelpers-01-tmdb-base-url.js";

export function getAddonBadgeLabel(name = "") {
  const cleaned = String(name || "").trim();
  if (!cleaned) {
    return "A";
  }
  if (/torrentio|torbox|torrent/i.test(cleaned)) {
    return "µ";
  }
  return (
    cleaned
      .split(/\s+/)
      .map((part) => part.charAt(0).toUpperCase())
      .join("")
      .slice(0, 2) || cleaned.charAt(0).toUpperCase()
  );
}

export function renderStreamAddonIcon(addonName = "") {
  const iconPath = getAddonIconPath(addonName);
  const fallback = escapeHtml(getAddonBadgeLabel(addonName));
  if (!iconPath) {
    return `<span class="series-stream-addon-fallback" aria-hidden="true">${fallback}</span>`;
  }
  return `
    <span class="series-stream-addon-badge" aria-hidden="true">
      <img class="series-stream-addon-icon" src="${escapeHtml(iconPath)}" alt="" decoding="async" onerror="this.hidden=true;var fallback=this.nextElementSibling;if(fallback){fallback.hidden=false;}" />
      <span class="series-stream-addon-fallback" hidden>${fallback}</span>
    </span>
  `;
}

export function escapeHtml(value = "") {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function escapeAttribute(value = "") {
  return escapeHtml(value);
}

export function escapeSelectorValue(value = "") {
  const raw = String(value ?? "");
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(raw);
  }
  return raw.replace(/["\\]/g, "\\$&");
}

export function normalizeCountryLabel(raw = "") {
  return String(raw || "")
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      return /^[A-Za-z]{2,3}$/.test(trimmed) ? trimmed.toUpperCase() : trimmed;
    })
    .filter(Boolean)
    .join(", ");
}

export function normalizePreviewItem(item = {}, fallbackType = "movie") {
  return {
    id: String(item.id || ""),
    name: item.name || item.title || "Untitled",
    type: item.type || item.apiType || fallbackType,
    poster: item.poster || "",
    landscapePoster: item.landscapePoster || item.background || item.poster || "",
    releaseInfo: item.releaseInfo || item.year || ""
  };
}

export function bestTraktArtwork(images = {}, kind) {
  const candidates = images?.[kind];
  const normalize = (value) => toTraktImageUrl(value);
  if (Array.isArray(candidates)) {
    return (
      candidates
        .filter((entry) => typeof entry === "string" && entry.trim())
        .map(normalize)
        .find(Boolean) || ""
    );
  }
  if (typeof candidates === "string") return normalize(candidates);
  if (candidates && typeof candidates === "object") {
    return [candidates.full, candidates.medium, candidates.thumb].map(normalize).find(Boolean) || "";
  }
  return "";
}

export function bestTraktLandscapeArtwork(images = {}) {
  return ["thumb", "fanart", "banner", "poster"].map((kind) => bestTraktArtwork(images, kind)).find(Boolean) || "";
}

export function bestTraktBackdropArtwork(images = {}) {
  return ["fanart", "banner", "thumb", "poster"].map((kind) => bestTraktArtwork(images, kind)).find(Boolean) || "";
}

export function traktRelatedPreview(media = {}, type = "movie") {
  const ids = media.ids || {};
  const id = ids.imdb ? String(ids.imdb) : ids.tmdb != null ? `tmdb:${ids.tmdb}` : ids.trakt != null ? `trakt:${ids.trakt}` : "";
  if (!id || !(media.title || media.original_title)) return null;
  const landscape = bestTraktLandscapeArtwork(media.images);
  const backdrop = bestTraktBackdropArtwork(media.images);
  return normalizePreviewItem(
    {
      id,
      name: media.title || media.original_title,
      type,
      poster: landscape,
      background: backdrop,
      landscapePoster: backdrop || landscape,
      releaseInfo: media.year == null ? "" : String(media.year)
    },
    type
  );
}

export function normalizeEpisodeTitle(rawTitle, episodeNumber) {
  const label = t("episodes_episode", {}, "Episode");
  const trimmed = String(rawTitle || "").trim();
  const number = Number(episodeNumber || 0);
  if (!trimmed) {
    return number > 0 ? `${label} ${number}` : label;
  }
  const match = trimmed.match(/^episode\s*(\d+)$/i);
  if (match) {
    return `${label} ${match[1]}`;
  }
  return trimmed;
}

export function extractPreviewYear(value = "") {
  const match = String(value || "").match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : "";
}

export function resolveYoutubeId(value = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) {
    return raw;
  }
  const watchMatch = raw.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch?.[1]) {
    return watchMatch[1];
  }
  const shortMatch = raw.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch?.[1]) {
    return shortMatch[1];
  }
  const embedMatch = raw.match(/embed\/([a-zA-Z0-9_-]{11})/);
  if (embedMatch?.[1]) {
    return embedMatch[1];
  }
  return "";
}

export function shouldUseDirectYoutubeEmbedOnTv() {
  return (Platform.isWebOS() || Platform.isTizen()) && !getYoutubeProxyBaseUrl();
}

export function getYoutubeProxyBaseUrl() {
  const configured = String(YOUTUBE_PROXY_URL || "").trim();
  if (Platform.isWebOS() || Platform.isTizen()) {
    // The local proxy is served from a file:// origin, which YouTube rejects
    // (embed error 153). Prefer a configured https-hosted proxy when available
    // so the embedding origin is valid; otherwise fall back to the local file.
    return /^https?:\/\//i.test(configured) ? configured : LOCAL_YOUTUBE_PROXY_URL;
  }
  return configured || LOCAL_YOUTUBE_PROXY_URL;
}

export function resolveTrailerPostMessageTargetOrigin(src = "") {
  try {
    const url = new URL(String(src || ""), globalThis?.location?.href || "https://example.com/");
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.origin;
    }
  } catch (_) {
    // Fall through to wildcard for opaque/file origins.
  }
  return "*";
}

export function resolveTrailerTrustedProxyOrigin() {
  try {
    const url = new URL(getYoutubeProxyBaseUrl(), globalThis?.location?.href || "https://example.com/");
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.origin;
    }
  } catch (_) {
    // Local file origins are validated by event.source instead.
  }
  return "";
}

export function buildDirectYoutubeEmbedUrl(
  cleanId = "",
  { muted = false, loop = true, captionsEnabled = false, captionsLanguage = "" } = {}
) {
  const videoId = String(cleanId || "").trim();
  if (!videoId || !Environment.isBrowser()) {
    return "";
  }
  const params = new URLSearchParams({
    autoplay: "1",
    mute: muted ? "1" : "0",
    controls: "0",
    loop: loop ? "1" : "0",
    playsinline: "1",
    rel: "0",
    modestbranding: "1",
    enablejsapi: "1",
    iv_load_policy: "3"
  });
  applyTrailerCaptionParams(params, { captionsEnabled, captionsLanguage });
  if (loop) {
    params.set("playlist", videoId);
  }
  const origin = String(globalThis?.location?.origin || "").trim();
  if (/^https?:\/\//i.test(origin)) {
    params.set("origin", origin);
  }
  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
}
