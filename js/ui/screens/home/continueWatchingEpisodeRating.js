import { imdbEpisodeRatingsRepository } from "../../../data/repository/imdbEpisodeRatingsRepository.js";
import { addonEpisodeAirDates } from "../../../data/repository/episodeRatingsAlignment.js";
import { TmdbService } from "../../../core/tmdb/tmdbService.js";

// Share the detail-screen provider and its in-flight cache. A slow rating lookup
// must not hold Continue Watching metadata indefinitely on a TV.
// addonVideos: the add-on's meta.videos, so ratings follow its own season split (Android).
export async function resolveContinueWatchingEpisodeRating(
  item = {},
  addonRating = null,
  addonVideos = []
) {
  const season = item.season == null ? null : Number(item.season);
  const episode = item.episode == null ? null : Number(item.episode);
  if (
    season == null ||
    !Number.isInteger(season) ||
    season < 0 ||
    !Number.isInteger(episode) ||
    episode <= 0
  )
    return null;
  const fallback = Number(addonRating);
  const fallbackRating = Number.isFinite(fallback) && fallback > 0 ? fallback : null;
  let timer;
  try {
    const lookup = (async () => {
      const contentId = String(item.contentId || item.id || "");
      const imdbCandidate = String(item.imdbId || contentId).split(":")[0];
      const imdbId = /^tt\d+$/i.test(imdbCandidate) ? imdbCandidate : null;
      const tmdbId =
        item.tmdbId ||
        (await TmdbService.ensureTmdbId(contentId, "series", { requireEnabled: false }));
      if (!imdbId && !tmdbId) return fallbackRating;
      const ratings = await imdbEpisodeRatingsRepository.getEpisodeRatings({
        imdbId,
        tmdbId,
        addonEpisodes: addonEpisodeAirDates(addonVideos)
      });
      const rating = Number(
        ratings?.[season]?.find((entry) => Number(entry.episode) === episode)?.rating
      );
      return Number.isFinite(rating) && rating > 0 ? rating : fallbackRating;
    })().catch(() => fallbackRating);
    return await Promise.race([
      lookup,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallbackRating), 1800);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
