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

import {
  shouldUseDirectYoutubeEmbedOnTv,
  buildDirectYoutubeEmbedUrl,
  getYoutubeProxyBaseUrl,
  resolveYoutubeId
} from "./metaDetailsScreenHelpers-05-get-addon-badge-label.js";
import { withTimeout } from "./metaDetailsScreenHelpers-03-meta-with-route-external-ids.js";

export function buildYoutubeEmbedUrl(ytId = "", { muted = false } = {}) {
  const cleanId = String(ytId || "").trim();
  if (!cleanId) {
    return "";
  }
  if (shouldUseDirectYoutubeEmbedOnTv()) {
    return buildDirectYoutubeEmbedUrl(cleanId, { muted });
  }
  const proxyBase = getYoutubeProxyBaseUrl();
  if (proxyBase) {
    try {
      const proxyUrl = new URL(proxyBase, globalThis?.location?.href || "https://example.com/");
      proxyUrl.searchParams.set("v", cleanId);
      proxyUrl.searchParams.set("autoplay", "1");
      proxyUrl.searchParams.set("muted", muted ? "1" : "0");
      proxyUrl.searchParams.set("controls", "0");
      proxyUrl.searchParams.set("loop", "1");
      proxyUrl.searchParams.set("playlist", cleanId);
      proxyUrl.searchParams.set("playsinline", "1");
      proxyUrl.searchParams.set("rel", "0");
      proxyUrl.searchParams.set("cc_load_policy", "0");
      proxyUrl.searchParams.set("_cb", `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      return proxyUrl.toString();
    } catch (_) {
      return "";
    }
  }
  if (!Environment.isBrowser()) {
    return "";
  }
  const params = new URLSearchParams({
    autoplay: "1",
    mute: muted ? "1" : "0",
    controls: "0",
    loop: "1",
    playlist: cleanId,
    playsinline: "1",
    rel: "0",
    modestbranding: "1",
    cc_load_policy: "0",
    enablejsapi: "1"
  });
  const origin = String(globalThis?.location?.origin || "").trim();
  if (/^https?:\/\//i.test(origin)) {
    params.set("origin", origin);
  }
  return `https://www.youtube-nocookie.com/embed/${cleanId}?${params.toString()}`;
}

export function buildInlineYoutubePlayerUrl(ytId = "", { muted = false, loop = false, statePollMs = 250 } = {}) {
  const cleanId = String(ytId || "").trim();
  if (!cleanId) {
    return "";
  }
  if (shouldUseDirectYoutubeEmbedOnTv()) {
    return buildDirectYoutubeEmbedUrl(cleanId, { muted, loop });
  }
  const proxyBase = getYoutubeProxyBaseUrl();
  if (proxyBase) {
    try {
      const proxyUrl = new URL(proxyBase, globalThis?.location?.href || "https://example.com/");
      proxyUrl.searchParams.set("v", cleanId);
      proxyUrl.searchParams.set("autoplay", "1");
      proxyUrl.searchParams.set("muted", muted ? "1" : "0");
      proxyUrl.searchParams.set("controls", "0");
      proxyUrl.searchParams.set("loop", loop ? "1" : "0");
      if (loop) {
        proxyUrl.searchParams.set("playlist", cleanId);
      } else {
        proxyUrl.searchParams.delete("playlist");
      }
      proxyUrl.searchParams.set("playsinline", "1");
      proxyUrl.searchParams.set("rel", "0");
      proxyUrl.searchParams.set("cc_load_policy", "0");
      proxyUrl.searchParams.set("state_poll_ms", String(Math.max(0, Number(statePollMs || 0))));
      proxyUrl.searchParams.set("_cb", `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      return proxyUrl.toString();
    } catch (_) {
      return "";
    }
  }
  const params = new URLSearchParams({
    autoplay: "1",
    mute: muted ? "1" : "0",
    controls: "0",
    loop: loop ? "1" : "0",
    playsinline: "1",
    rel: "0",
    modestbranding: "1",
    enablejsapi: "1"
  });
  if (loop) {
    params.set("playlist", cleanId);
  }
  const origin = String(globalThis?.location?.origin || "").trim();
  if (/^https?:\/\//i.test(origin)) {
    params.set("origin", origin);
  }
  return `https://www.youtube-nocookie.com/embed/${cleanId}?${params.toString()}`;
}

export function resolveTrailerSource(meta = {}) {
  const trailerCandidates = [...(Array.isArray(meta?.trailers) ? meta.trailers : []), ...(Array.isArray(meta?.videos) ? meta.videos : [])];
  for (const entry of trailerCandidates) {
    const ytId = resolveYoutubeId(entry?.ytId || entry?.youtubeId || entry?.source || entry?.url || entry?.link || "");
    if (ytId) {
      const embedUrl = buildYoutubeEmbedUrl(ytId);
      if (!embedUrl) {
        continue;
      }
      return {
        kind: "youtube",
        ytId,
        embedUrl
      };
    }
  }
  const ytId = resolveYoutubeId(Array.isArray(meta?.trailerYtIds) ? meta.trailerYtIds[0] : "");
  if (!ytId) {
    return null;
  }
  const embedUrl = buildYoutubeEmbedUrl(ytId);
  if (!embedUrl) {
    return null;
  }
  return {
    kind: "youtube",
    ytId,
    embedUrl
  };
}

export async function resolveTmdbTrailerSource(meta = {}, itemType = "movie") {
  const fallbackSource = resolveTrailerSource(meta);
  const settings = TmdbSettingsStore.get();
  if (!settings.enabled || !settings.useTrailers || !TMDB_API_KEY || !meta?.id) {
    return fallbackSource;
  }
  try {
    const tmdbId = await withTimeout(TmdbService.ensureTmdbId(meta.id, itemType), 1800, null);
    if (!tmdbId) {
      return fallbackSource;
    }
    const trailers = await withTimeout(
      TmdbMetadataService.fetchTrailerCandidates({
        tmdbId,
        contentType: itemType,
        language: settings.language
      }),
      2200,
      []
    );
    return resolveTrailerSource({ trailers }) || fallbackSource;
  } catch (_) {
    return fallbackSource;
  }
}

export function resolveTrailerItems(meta = {}) {
  const candidates = [
    ...(Array.isArray(meta?.trailers) ? meta.trailers : []),
    ...(Array.isArray(meta?.trailerYtIds) ? meta.trailerYtIds.map((ytId) => ({ ytId, name: "Trailer" })) : [])
  ];
  const seen = new Set();
  return candidates
    .map((entry) => {
      const ytId = resolveYoutubeId(
        typeof entry === "string" ? entry : entry?.ytId || entry?.youtubeId || entry?.source || entry?.url || entry?.link || ""
      );
      if (!ytId || seen.has(ytId)) return null;
      seen.add(ytId);
      return {
        ytId,
        name: typeof entry === "object" ? entry.name || entry.type || "Trailer" : "Trailer",
        type: typeof entry === "object" ? entry.type || "" : "",
        lang: typeof entry === "object" ? entry.lang || entry.language || "" : ""
      };
    })
    .filter(Boolean);
}

export function stripTraktSpoilerMarkup(value = "") {
  return String(value || "")
    .replace(/\[\/?spoiler\]/gi, "")
    .replace(/[\t ]+/g, " ")
    .trim();
}

export function containsTraktInlineSpoiler(value = "") {
  return /\[spoiler\].*?\[\/spoiler\]/is.test(String(value || ""));
}

export function formatEpisodeCardDate(value = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const localDateMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  const parsed =
    localDateMatch && !raw.includes("T")
      ? new Date(Number(localDateMatch[1]), Number(localDateMatch[2]) - 1, Number(localDateMatch[3]))
      : new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toLocaleDateString(I18n.getLocale(), {
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}
