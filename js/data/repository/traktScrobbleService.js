import { TraktAuthService, requestJson } from "./traktAuthService.js";
import { TraktEpisodeMappingService } from "./traktEpisodeMappingService.js";

const START_DEBOUNCE_MS = 15000;
const MAX_CONSECUTIVE_FAILURES = 3;
const WATCHED_THRESHOLD_PERCENT = 80;

let startDebounceTimer = null;
let consecutiveFailures = 0;
let lastAction = null;

function clearStartTimer() {
  if (startDebounceTimer) {
    clearTimeout(startDebounceTimer);
    startDebounceTimer = null;
  }
}

function buildMoviePayload(context) {
  const movie = { title: context.title };
  if (context.year) {
    movie.year = context.year;
  }
  const ids = {};
  if (context.imdbId) {
    ids.imdb = context.imdbId;
  }
  if (context.tmdbId) {
    ids.tmdb = context.tmdbId;
  }
  if (context.traktId) {
    ids.trakt = context.traktId;
  }
  if (Object.keys(ids).length) {
    movie.ids = ids;
  }
  return { movie, progress: context.progressPercent };
}

function buildEpisodePayload(context) {
  const show = { title: context.title };
  if (context.year) {
    show.year = context.year;
  }
  const showIds = {};
  if (context.imdbId) {
    showIds.imdb = context.imdbId;
  }
  if (context.tmdbId) {
    showIds.tmdb = context.tmdbId;
  }
  if (context.traktId) {
    showIds.trakt = context.traktId;
  }
  if (Object.keys(showIds).length) {
    show.ids = showIds;
  }
  const episode = {
    season: context.seasonNumber,
    number: context.episodeNumber
  };
  if (context.episodeTitle) {
    episode.title = context.episodeTitle;
  }
  return { show, episode, progress: context.progressPercent };
}

function buildScrobblePayload(context) {
  return context.contentType === "series"
    ? buildEpisodePayload(context)
    : buildMoviePayload(context);
}

async function markAsWatchedLocally(context) {
  try {
    const { watchedItemsRepository } = await import("./watchedItemsRepository.js");
    const item = {
      contentId: context.contentId,
      contentType: context.contentType,
      imdbId: context.imdbId || null,
      tmdbId: context.tmdbId || null,
      traktId: context.traktId || null,
      watchedAt: Date.now()
    };
    if (context.contentType === "series") {
      item.season = context.seasonNumber;
      item.episode = context.episodeNumber;
    }
    await watchedItemsRepository.mark(item, { skipTrackingWrite: true });
  } catch (error) {
    console.warn("[TraktScrobble] mark-as-watched failed", error);
  }
}

async function sendScrobbleRequest(action, context) {
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    return;
  }

  if (!context?.imdbId && !context?.tmdbId && !context?.traktId) {
    return;
  }

  try {
    const accessToken = await TraktAuthService.getValidAccessToken();
    if (!accessToken) {
      return;
    }

    // The stream screen and player know the add-on's episode numbers; Trakt needs its own.
    let scrobbleContext = context;
    if (
      context.contentType === "series" &&
      context.seasonNumber != null &&
      context.episodeNumber != null
    ) {
      const mapped = await TraktEpisodeMappingService.resolveAddonToTrakt({
        contentId: context.contentId,
        contentType: "series",
        videoId: context.videoId || null,
        season: context.seasonNumber,
        episode: context.episodeNumber,
        title: context.episodeTitle || null,
        traktId: context.traktId || null,
        imdbId: context.imdbId || null
      }).catch(() => null);
      if (mapped) {
        scrobbleContext = {
          ...context,
          seasonNumber: mapped.season,
          episodeNumber: mapped.episode
        };
      }
    }

    const body = buildScrobblePayload(scrobbleContext);
    const { response } = await requestJson(`/scrobble/${action}`, {
      method: "POST",
      body,
      authorization: `Bearer ${accessToken}`
    });

    if (response.ok) {
      consecutiveFailures = 0;
      lastAction = action;

      if (action === "stop" && context.progressPercent >= WATCHED_THRESHOLD_PERCENT) {
        await markAsWatchedLocally(context);
      }
    } else {
      consecutiveFailures++;
      console.warn(`[TraktScrobble] ${action} failed`, {
        status: response.status,
        failures: consecutiveFailures
      });
    }
  } catch (error) {
    consecutiveFailures++;
    console.warn(`[TraktScrobble] ${action} error`, {
      error: error.message,
      failures: consecutiveFailures
    });
  }
}

export const TraktScrobbleService = {
  isEnabled() {
    return TraktAuthService.isAuthenticated();
  },

  start(context) {
    clearStartTimer();
    startDebounceTimer = setTimeout(() => {
      startDebounceTimer = null;
      void sendScrobbleRequest("start", context);
    }, START_DEBOUNCE_MS);
  },

  pause(context) {
    clearStartTimer();
    if (lastAction === "start" || lastAction === null) {
      void sendScrobbleRequest("stop", context);
    }
  },

  stop(context) {
    clearStartTimer();
    void sendScrobbleRequest("stop", context);
    lastAction = null;
  },

  cancel() {
    clearStartTimer();
    lastAction = null;
  }
};
