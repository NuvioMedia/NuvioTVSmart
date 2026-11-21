import { WatchProgressStore } from "../local/watchProgressStore.js";
import { WatchedItemsStore } from "../local/watchedItemsStore.js";

export function serverUserState(item) {
  const user = item?.UserData || {};
  const positionMs = Number(user.PlaybackPositionTicks) / 10000;
  const durationMs = Number(item?.RunTimeTicks) / 10000;
  const lastPlayed = Date.parse(user.LastPlayedDate || "");
  return {
    played: user.Played === true,
    positionMs: Number.isFinite(positionMs) && positionMs > 0 ? positionMs : 0,
    durationMs: Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0,
    updatedAt: Number.isFinite(lastPlayed) ? lastPlayed : null
  };
}

function serverContentId(connectionId, itemId) {
  return `server:${encodeURIComponent(String(connectionId))}:${encodeURIComponent(String(itemId))}`;
}

// Cards from the old media-server resume row stored the episode id as the
// content id, while Android always uses the series id. When the series behind
// an episode is known, move its progress and watched records to that identity
// so Continue Watching and Next Up see one title instead of both.
export function reassignServerItemIdentity(
  connectionId,
  episodeItemId,
  seriesMeta,
  profileId = "1"
) {
  const episodeContentId = serverContentId(connectionId, episodeItemId);
  const seriesContentId = String(seriesMeta?.id || "");
  if (!seriesContentId.startsWith("server:") || seriesContentId === episodeContentId) {
    return;
  }
  const display = {};
  if (seriesMeta.name) display.title = seriesMeta.name;
  if (seriesMeta.poster) display.poster = seriesMeta.poster;
  if (seriesMeta.background) display.background = seriesMeta.background;
  if (seriesMeta.logo) display.logo = seriesMeta.logo;

  const progress = WatchProgressStore.listForProfile(profileId);
  const episodeProgress = progress.filter((entry) => entry.contentId === episodeContentId);
  if (episodeProgress.length) {
    WatchProgressStore.replaceForProfile(profileId, [
      ...progress.filter((entry) => entry.contentId !== episodeContentId),
      ...episodeProgress.map((entry) => ({ ...entry, ...display, contentId: seriesContentId }))
    ]);
  }

  const watched = WatchedItemsStore.listForProfile(profileId);
  const episodeWatched = watched.filter((entry) => entry.contentId === episodeContentId);
  if (episodeWatched.length) {
    WatchedItemsStore.replaceForProfile(profileId, [
      ...watched.filter((entry) => entry.contentId !== episodeContentId),
      ...episodeWatched.map((entry) => ({
        ...entry,
        contentId: seriesContentId,
        ...(seriesMeta.name ? { title: seriesMeta.name } : {})
      }))
    ]);
  }
}

export function newerServerResume(state, saved, startFromBeginning = false) {
  if (
    startFromBeginning ||
    !state ||
    state.played ||
    !(state.positionMs > 0) ||
    !(state.durationMs > 0) ||
    !(state.updatedAt > 0)
  )
    return null;
  if (saved && Number(saved.updatedAt || 0) >= state.updatedAt) return null;
  return state;
}

// Apply only native server details. Catalog-metadata mode keeps its existing
// tracking identity; Android does not project server state onto those titles.
export function projectServerUserState(meta, items, profileId, now = Date.now()) {
  if (!String(meta?.id || "").startsWith("server:")) return;
  const series = meta.type === "series";
  const progress = WatchProgressStore.listForProfile(profileId);
  const watched = WatchedItemsStore.listForProfile(profileId);
  const progressUpdates = [];
  const watchedUpdates = [];
  for (const item of items) {
    const season = series ? item.ParentIndexNumber : null;
    const episode = series ? item.IndexNumber : null;
    if (series && (!Number.isInteger(season) || !Number.isInteger(episode))) continue;
    const state = serverUserState(item);
    const matches = (entry) =>
      entry.contentId === meta.id &&
      (entry.season ?? null) === season &&
      (entry.episode ?? null) === episode;
    const existing = progress.find(matches);
    if (newerServerResume(state, existing)) {
      progressUpdates.push({
        contentId: meta.id,
        contentType: meta.type,
        name: meta.name,
        poster: meta.poster,
        backdrop: meta.background,
        logo: meta.logo,
        videoId: series
          ? `server:${encodeURIComponent(meta.serverItem.connectionId)}:${encodeURIComponent(item.Id)}`
          : meta.id,
        season,
        episode,
        episodeTitle: series ? item.Name : null,
        positionMs: state.positionMs,
        durationMs: state.durationMs,
        updatedAt: state.updatedAt,
        source: "media_server",
        addonBaseUrl: `nuvio-server://${meta.serverItem.connectionId}`
      });
    }
    const locallyWatched = watched.some(matches);
    if (state.played && !locallyWatched) {
      watchedUpdates.push({
        contentId: meta.id,
        contentType: meta.type,
        title: meta.name,
        videoId: series
          ? `server:${encodeURIComponent(meta.serverItem.connectionId)}:${encodeURIComponent(item.Id)}`
          : meta.id,
        season,
        episode,
        watchedAt: state.updatedAt || now
      });
    } else if (!state.played && locallyWatched && item.UserData) {
      WatchedItemsStore.remove(
        meta.id,
        profileId,
        series ? { season, episode } : { rootOnly: true }
      );
    }
  }
  WatchProgressStore.upsertMany(progressUpdates, profileId);
  WatchedItemsStore.upsertMany(watchedUpdates, profileId);
}
