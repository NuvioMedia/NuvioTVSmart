// Episode numbering translation between an add-on's list and a tracking provider's list.
// Ported from Android NuvioTV data/repository/TraktEpisodeMapping.kt so anime split into
// different seasons (TMDB S1E35 = add-on S2E11) keeps watched marks, resume and scrobbles aligned.

const NON_ALPHANUMERIC = /[^a-z0-9]+/g;
const COLLAPSED_SPACES = /\s+/g;
const NUMBERED_TITLE = /^(episode|ep|e) \d+$/;
const TITLE_CACHE_LIMIT = 4000;

const titleCache = new Map();

export function normalizeEpisodeTitle(title) {
  const raw = String(title ?? "");
  if (!raw) {
    return "";
  }
  const cached = titleCache.get(raw);
  if (cached !== undefined) {
    return cached;
  }
  const normalized = raw
    .toLowerCase()
    .replace(NON_ALPHANUMERIC, " ")
    .trim()
    .replace(COLLAPSED_SPACES, " ");
  if (titleCache.size >= TITLE_CACHE_LIMIT) {
    titleCache.delete(titleCache.keys().next().value);
  }
  titleCache.set(raw, normalized);
  return normalized;
}

/** A title that only repeats the episode number never matches another provider's episode. */
export function isUsefulEpisodeTitle(normalizedTitle) {
  const value = String(normalizedTitle || "");
  return Boolean(value) && !NUMBERED_TITLE.test(value);
}

export function createEpisodeMappingEntry(season, episode, { title = null, videoId = null } = {}) {
  const seasonNumber = Number(season);
  const episodeNumber = Number(episode);
  if (!Number.isInteger(seasonNumber) || !Number.isInteger(episodeNumber)) {
    return null;
  }
  if (seasonNumber <= 0 || episodeNumber <= 0) {
    return null;
  }
  return {
    season: seasonNumber,
    episode: episodeNumber,
    title: String(title ?? "").trim() || null,
    videoId: String(videoId ?? "").trim() || null
  };
}

/** Add-on videos (`meta.videos`) as mapping entries, in the same shape Android builds. */
export function episodeMappingEntries(videos = []) {
  const seen = new Set();
  const entries = [];
  (Array.isArray(videos) ? videos : []).forEach((video) => {
    const entry = createEpisodeMappingEntry(video?.season, video?.episode, {
      title: video?.title,
      videoId: video?.id
    });
    if (!entry) {
      return;
    }
    const key = entry.videoId || `${entry.season}:${entry.episode}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    entries.push(entry);
  });
  return sortEpisodes(entries);
}

function sortEpisodes(entries = []) {
  return [...entries].sort(
    (left, right) => left.season - right.season || left.episode - right.episode
  );
}

export function seasonCounts(episodes = []) {
  const counts = new Map();
  (Array.isArray(episodes) ? episodes : []).forEach((entry) => {
    const season = Number(entry?.season);
    if (!Number.isInteger(season) || season <= 0) {
      return;
    }
    counts.set(season, (counts.get(season) || 0) + 1);
  });
  return counts;
}

/** Same season numbers and same episode count per season, as Android's hasSameSeasonStructure. */
export function hasSameSeasonStructure(left = [], right = []) {
  const leftCounts = seasonCounts(left);
  const rightCounts = seasonCounts(right);
  if (leftCounts.size !== rightCounts.size) {
    return false;
  }
  for (const [season, count] of leftCounts) {
    if (rightCounts.get(season) !== count) {
      return false;
    }
  }
  return true;
}

export function hasSameSeasonNumbers(left = [], right = []) {
  const leftSeasons = [...seasonCounts(left).keys()].sort((a, b) => a - b);
  const rightSeasons = [...seasonCounts(right).keys()].sort((a, b) => a - b);
  if (leftSeasons.length !== rightSeasons.length) {
    return false;
  }
  return leftSeasons.every((season, index) => season === rightSeasons[index]);
}

/**
 * Android remapEpisodeBetweenLists: find the episode in [sourceEpisodes] by video id or
 * season/number, then the same episode in [targetEpisodes] by a unique title, else by position.
 */
export function remapEpisodeBetweenLists({
  requestedSeason,
  requestedEpisode,
  requestedVideoId = null,
  requestedTitle = null,
  sourceEpisodes = [],
  targetEpisodes = [],
  preferSameNumberOverIndex = false
} = {}) {
  const source = sortEpisodes(sourceEpisodes.filter(Boolean));
  const target = sortEpisodes(targetEpisodes.filter(Boolean));
  if (!source.length || !target.length) {
    return null;
  }
  const season = Number(requestedSeason);
  const episode = Number(requestedEpisode);
  const videoId = String(requestedVideoId ?? "").trim();

  const currentSourceEpisode =
    (videoId && source.find((entry) => entry.videoId === videoId)) ||
    source.find((entry) => entry.season === season && entry.episode === episode) ||
    null;
  if (!currentSourceEpisode) {
    return null;
  }

  const normalizedTitle = normalizeEpisodeTitle(requestedTitle ?? currentSourceEpisode.title);
  if (isUsefulEpisodeTitle(normalizedTitle)) {
    const titleMatches = target.filter(
      (entry) => normalizeEpisodeTitle(entry.title) === normalizedTitle
    );
    if (titleMatches.length === 1) {
      return titleMatches[0];
    }
  }

  // Whole-show indexing shifts every later episode when an earlier season's count
  // differs. A write keeps the number when the target has that exact episode.
  if (preferSameNumberOverIndex) {
    const sameNumber = target.find(
      (entry) =>
        entry.season === currentSourceEpisode.season &&
        entry.episode === currentSourceEpisode.episode
    );
    if (sameNumber) {
      return sameNumber;
    }
  }

  const sourceIndex = source.indexOf(currentSourceEpisode);
  return sourceIndex >= 0 && sourceIndex < target.length ? target[sourceIndex] : null;
}

/** Add-on numbering -> provider numbering (scrobble, watched history write). */
export function remapEpisodeByTitleOrIndex({
  requestedSeason,
  requestedEpisode,
  requestedVideoId = null,
  requestedTitle = null,
  addonEpisodes = [],
  providerEpisodes = [],
  preferSameNumberOverIndex = false
} = {}) {
  return remapEpisodeBetweenLists({
    requestedSeason,
    requestedEpisode,
    requestedVideoId,
    requestedTitle,
    sourceEpisodes: addonEpisodes,
    targetEpisodes: providerEpisodes,
    preferSameNumberOverIndex
  });
}

/** Provider numbering -> add-on numbering (watched marks, continue watching, resume). */
export function reverseRemapEpisodeByTitleOrIndex({
  requestedSeason,
  requestedEpisode,
  requestedVideoId = null,
  requestedTitle = null,
  addonEpisodes = [],
  providerEpisodes = []
} = {}) {
  return remapEpisodeBetweenLists({
    requestedSeason,
    requestedEpisode,
    requestedVideoId,
    requestedTitle,
    sourceEpisodes: providerEpisodes,
    targetEpisodes: addonEpisodes
  });
}

export function clearEpisodeMappingTitleCache() {
  titleCache.clear();
}
