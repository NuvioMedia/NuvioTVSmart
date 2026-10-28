import { mdbAliases, mdbContentId, invalidMdbTracking } from "./mdbListTrackingCodec.js";

// Build aliases once per snapshot, rather than scanning the watched library per episode.
export function normalizeMdbSnapshot(snapshot) {
  const aliases = new Map();
  const keyFor = (type, alias) => `${type === "movie" ? "movie" : "show"}:${alias}`;
  for (const record of [...snapshot.watched, ...snapshot.playback]) {
    const keys = mdbAliases(record.media.ids).map((alias) => keyFor(record.type, alias));
    const matches = [...new Set(keys.map((key) => aliases.get(key)).filter(Boolean))];
    const group = matches[0] || { ids: {}, media: {}, keys: new Set() };
    for (const other of matches.slice(1)) {
      merge(group, other.ids, other.media);
      for (const key of other.keys) {
        aliases.set(key, group);
        group.keys.add(key);
      }
    }
    merge(group, record.media.ids, record.media);
    for (const key of keys) {
      aliases.set(key, group);
      group.keys.add(key);
    }
  }
  function merge(group, ids, media) {
    for (const [key, id] of Object.entries(ids)) {
      if (group.ids[key] != null && group.ids[key] !== id) invalidMdbTracking();
      group.ids[key] = id;
    }
    for (const [key, value] of Object.entries(media))
      if (key !== "ids" && value) group.media[key] ||= value;
  }
  const normalize = (rows) => {
    const unique = new Map();
    for (const row of rows) {
      const group = aliases.get(keyFor(row.type, mdbAliases(row.media.ids)[0]));
      const next = { ...row, media: { ...group.media, ids: group.ids } };
      const key = `${row.type}:${mdbContentId(group.ids)}:${row.season}:${row.episode}`;
      const previous = unique.get(key);
      if (!previous || next.updatedAt >= previous.updatedAt) unique.set(key, next);
    }
    return [...unique.values()];
  };
  return {
    ...snapshot,
    watched: normalize(snapshot.watched),
    playback: normalize(snapshot.playback)
  };
}
export function projectMdbTracking(snapshot) {
  const watchedItems = [],
    historyItems = [],
    playbackItems = [],
    watchedShowSeedItems = [];
  const history = new Map(),
    hiddenById = new Map(),
    mediaByAlias = new Map();
  for (const row of [...snapshot.watched, ...snapshot.playback])
    if (row.type !== "movie") {
      for (const alias of mdbAliases(row.media.ids)) mediaByAlias.set(alias, row.media.ids);
    }
  for (const row of snapshot.dropped) {
    const resolved =
      mdbAliases(row.ids)
        .map((alias) => mediaByAlias.get(alias))
        .find(Boolean) || row.ids;
    for (const alias of mdbAliases({ ...row.ids, ...resolved })) {
      if (!hiddenById.has(alias)) hiddenById.set(alias, new Set());
      hiddenById.get(alias).add(row.season);
    }
  }
  const hidden = (ids, season = null) => {
    const seasons = hiddenById.get(mdbContentId(ids));
    return seasons?.has(null) === true || seasons?.has(season) === true;
  };
  const base = (row, progress, source) => {
    const { media, season, episode } = row,
      ids = media.ids,
      contentId = mdbContentId(ids);
    return {
      contentId,
      contentType: row.type === "movie" ? "movie" : "series",
      ids,
      imdbId: ids.imdb || null,
      tmdbId: ids.tmdb || null,
      tvdbId: ids.tvdb || null,
      traktId: ids.trakt || null,
      title: media.title || contentId,
      name: media.title || contentId,
      year: media.year,
      poster: media.poster,
      background: media.background,
      backdrop: media.background,
      videoId: row.type === "movie" ? contentId : `${contentId}:${season}:${episode}`,
      season,
      episode,
      episodeTitle: row.episodeTitle || null,
      positionMs: 0,
      durationMs: (row.runtime || media.runtime || 0) * 60000,
      progressPercent: progress,
      updatedAt: row.updatedAt,
      source,
      trackingProviderId: "mdblist",
      completionThresholdOverride: 0.8
    };
  };
  const key = (row) => `${row.type}:${mdbContentId(row.media.ids)}:${row.season}:${row.episode}`;
  for (const row of snapshot.watched) {
    history.set(key(row), row.updatedAt);
    if (!["movie", "episode"].includes(row.type)) continue;
    const item = { ...base(row, 100, "mdblist_history"), watchedAt: row.updatedAt };
    watchedItems.push(item);
    if (row.type === "episode" && row.season > 0 && !hidden(row.media.ids)) {
      watchedShowSeedItems.push({
        ...item,
        excludedNextUpSeasons: [...(hiddenById.get(mdbContentId(row.media.ids)) || [])].filter(
          (season) => season != null
        )
      });
    }
  }
  for (const row of snapshot.playback) {
    if (
      row.progress >= 80 ||
      hidden(row.media.ids, row.season) ||
      (history.get(key(row)) || 0) >= row.updatedAt
    )
      continue;
    playbackItems.push(base(row, row.progress, "mdblist_playback"));
  }
  return { watchedItems, historyItems, playbackItems, watchedShowSeedItems, hiddenById };
}
