import { metaRepository } from "./metaRepository.js";
import { watchedItemsRepository } from "./watchedItemsRepository.js";
import { watchProgressRepository } from "./watchProgressRepository.js";
import { detailWatchedEnrichmentService } from "./detailWatchedEnrichmentService.js";
import { isWatchProgressCompleted } from "../../domain/model/watchProgress.js";

function isSeriesType(type = "") {
  const normalized = String(type || "")
    .trim()
    .toLowerCase();
  return ["series", "tv", "anime", "show", "tvshow"].includes(normalized);
}

function firstPositiveInt(values = []) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isInteger(numeric) && numeric > 0) {
      return numeric;
    }
  }
  return null;
}

function parseSeasonEpisodeFromVideoId(rawId = "") {
  const id = String(rawId || "").trim();
  if (!id) {
    return null;
  }
  const parts = id.split(":");
  if (parts.length < 3) {
    return null;
  }
  const season = Number(parts[parts.length - 2]);
  const episode = Number(parts[parts.length - 1]);
  if (!Number.isInteger(season) || season <= 0 || !Number.isInteger(episode) || episode <= 0) {
    return null;
  }
  return { season, episode };
}

function normalizeEpisode(video = {}) {
  const parsed = parseSeasonEpisodeFromVideoId(video.id);
  const episode = firstPositiveInt([
    video.episode,
    video.episodeNumber,
    video.number,
    parsed?.episode
  ]);
  const season =
    firstPositiveInt([video.season, video.seasonNumber, parsed?.season]) || (episode ? 1 : null);
  if (!video.id || !season || !episode) {
    return null;
  }
  return {
    id: String(video.id || ""),
    title: String(video.title || video.name || `S${season}E${episode}`),
    season,
    episode,
    released:
      video.released ||
      video.releaseDate ||
      video.release_date ||
      video.firstAired ||
      video.first_aired ||
      video.airDate ||
      video.air_date ||
      "",
    available: video.available
  };
}

function isReleasedEpisode(episode = {}, today = new Date()) {
  if (episode.available === false) {
    return false;
  }
  const rawDate = String(episode.released || "").trim();
  if (!rawDate) {
    return true;
  }
  const parsed = Date.parse(rawDate);
  if (!Number.isFinite(parsed)) {
    return true;
  }
  return parsed <= today.getTime();
}

function watchedEpisodeKey(season, episode) {
  return `${Number(season)}:${Number(episode)}`;
}

function getReleasedMainEpisodes(meta = {}) {
  const today = new Date();
  return (Array.isArray(meta?.videos) ? meta.videos : [])
    .map((video) => normalizeEpisode(video))
    .filter(Boolean)
    .filter((episode) => episode.season > 0 && isReleasedEpisode(episode, today))
    .sort((left, right) => {
      if (left.season !== right.season) {
        return left.season - right.season;
      }
      return left.episode - right.episode;
    });
}

function progressMatchesContent(progress = {}, contentIds = new Set()) {
  return contentIds.has(String(progress.contentId || ""));
}

function progressEpisodeKey(progress = {}) {
  const season = firstPositiveInt([progress.season, progress.seasonNumber]);
  const episode = firstPositiveInt([progress.episode, progress.episodeNumber]);
  if (season && episode) {
    return watchedEpisodeKey(season, episode);
  }
  const parsed = parseSeasonEpisodeFromVideoId(progress.videoId);
  return parsed ? watchedEpisodeKey(parsed.season, parsed.episode) : "";
}

function watchedItemEpisodeKey(item = {}) {
  if (item.season == null || item.episode == null) {
    return "";
  }
  return watchedEpisodeKey(item.season, item.episode);
}

function buildContentIds(contentId, meta = {}) {
  return new Set([contentId, meta?.id].map((value) => String(value || "").trim()).filter(Boolean));
}

async function loadSeriesMeta(contentId, contentType, meta = null) {
  if (meta && Array.isArray(meta.videos)) {
    return meta;
  }
  try {
    const result = await metaRepository.getMetaFromAllAddons(contentType || "series", contentId);
    return result?.status === "success" ? result.data : result;
  } catch (error) {
    console.warn("[watchedSeries] failed to load series meta", error);
    return null;
  }
}

async function markReleasedEpisodes(contentId, contentType, meta, watchedAt = Date.now()) {
  const episodes = getReleasedMainEpisodes(meta);
  if (!episodes.length) {
    return false;
  }
  for (const episode of episodes) {
    await watchedItemsRepository.mark({
      contentId,
      contentType,
      title: episode.title || meta?.name || contentId,
      season: episode.season,
      episode: episode.episode,
      watchedAt
    });
    await watchProgressRepository.saveProgress({
      contentId,
      contentType,
      videoId: episode.id,
      season: episode.season,
      episode: episode.episode,
      title: meta?.name || null,
      episodeTitle: episode.title || null,
      positionMs: 100,
      durationMs: 100,
      updatedAt: watchedAt
    });
  }
  return true;
}

export const watchedSeriesReconciliationService = {
  isSeriesType,

  async reconcile(contentId, contentType = "series", options = {}) {
    const normalizedContentId = String(contentId || "").trim();
    const normalizedType = String(contentType || "series").trim() || "series";
    if (!normalizedContentId || !isSeriesType(normalizedType)) {
      return false;
    }

    const meta = await loadSeriesMeta(normalizedContentId, normalizedType, options.meta || null);
    const episodes = getReleasedMainEpisodes(meta || {});
    if (!episodes.length) {
      return false;
    }

    const contentIds = buildContentIds(normalizedContentId, meta);
    const [watchedItems, progressItems, hasSeriesMarker] = await Promise.all([
      watchedItemsRepository.getAll(5000).catch(() => []),
      watchProgressRepository.getAll().catch(() => []),
      watchedItemsRepository.isWatched(normalizedContentId).catch(() => false)
    ]);

    const watchedEpisodeKeys = new Set();
    watchedItems.forEach((item) => {
      if (!contentIds.has(String(item?.contentId || ""))) {
        return;
      }
      const key = watchedItemEpisodeKey(item);
      if (key) {
        watchedEpisodeKeys.add(key);
      }
    });
    progressItems.forEach((progress) => {
      if (!progressMatchesContent(progress, contentIds) || !isWatchProgressCompleted(progress)) {
        return;
      }
      const key = progressEpisodeKey(progress);
      if (key) {
        watchedEpisodeKeys.add(key);
      }
    });

    const completedEpisode = options.completedEpisode || null;
    if (completedEpisode?.season && completedEpisode?.episode) {
      watchedEpisodeKeys.add(watchedEpisodeKey(completedEpisode.season, completedEpisode.episode));
    }

    const allWatched = episodes.every((episode) =>
      watchedEpisodeKeys.has(watchedEpisodeKey(episode.season, episode.episode))
    );

    if (allWatched && !hasSeriesMarker) {
      await watchedItemsRepository.mark({
        contentId: normalizedContentId,
        contentType: normalizedType,
        title: meta?.name || options.title || normalizedContentId,
        watchedAt: Date.now()
      });
      detailWatchedEnrichmentService.invalidateCache(normalizedContentId);
      return true;
    }

    if (!allWatched && hasSeriesMarker) {
      await watchedItemsRepository.unmark(normalizedContentId, { rootOnly: true });
      detailWatchedEnrichmentService.invalidateCache(normalizedContentId);
      return true;
    }

    return false;
  },

  async markSeriesWatched(contentId, contentType = "series", options = {}) {
    const normalizedContentId = String(contentId || "").trim();
    const normalizedType = String(contentType || "series").trim() || "series";
    if (!normalizedContentId || !isSeriesType(normalizedType)) {
      return false;
    }
    const watchedAt = Date.now();
    const meta = await loadSeriesMeta(normalizedContentId, normalizedType, options.meta || null);
    await watchedItemsRepository.mark({
      contentId: normalizedContentId,
      contentType: normalizedType,
      title: meta?.name || options.title || normalizedContentId,
      watchedAt
    });
    if (meta) {
      await markReleasedEpisodes(normalizedContentId, normalizedType, meta, watchedAt);
    }
    detailWatchedEnrichmentService.invalidateCache(normalizedContentId);
    return true;
  },

  async unmarkSeriesWatched(contentId, options = {}) {
    const normalizedContentId = String(contentId || "").trim();
    if (!normalizedContentId) {
      return false;
    }
    const meta = options.meta || null;
    const episodes = getReleasedMainEpisodes(meta || {});
    await watchedItemsRepository.unmark(normalizedContentId);
    await watchProgressRepository.removeProgress(normalizedContentId);
    for (const episode of episodes) {
      await watchedItemsRepository.unmark(normalizedContentId, {
        season: episode.season,
        episode: episode.episode
      });
      await watchProgressRepository.removeProgress(normalizedContentId, episode.id);
    }
    detailWatchedEnrichmentService.invalidateCache(normalizedContentId);
    return true;
  }
};
