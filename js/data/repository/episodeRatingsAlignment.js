// Android EpisodeRatingsAlignment: external episode ratings use the provider's season and
// episode numbers. Anime that the add-on splits into fewer seasons than the provider (Black
// Clover: 2 vs 5) would show the ratings of other episodes, or none. When both sides use the
// same seasons nothing changes; otherwise aired episodes are paired in airing order when their
// totals match, and by air date when they do not. Specials keep their numbers.

const DAY_MS = 24 * 60 * 60 * 1000;

function parseAirDay(value) {
  const date = String(value ?? "")
    .trim()
    .slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const time = Date.UTC(year, month - 1, day);
  const parsed = new Date(time);
  // LocalDate.parse rejects impossible dates such as 2020-02-31.
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  )
    return null;
  return Math.floor(time / DAY_MS);
}

function localEpochDay(now = new Date()) {
  return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS);
}

function toInteger(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

const key = (season, episode) => `${season}:${episode}`;

function distinctSorted(entries) {
  const seen = new Set();
  return entries
    .filter((entry) => {
      const entryKey = key(entry.season, entry.episode);
      if (seen.has(entryKey)) return false;
      seen.add(entryKey);
      return true;
    })
    .sort((left, right) => left.season - right.season || left.episode - right.episode);
}

function groupByDay(entries) {
  const groups = new Map();
  entries.forEach((entry) => {
    if (entry.day == null) return;
    if (!groups.has(entry.day)) groups.set(entry.day, []);
    groups.get(entry.day).push(entry);
  });
  return groups;
}

/**
 * @param {Array<{season: number|null, episode: number|null, released: string|null}>} addonEpisodes
 * @param {Array<{season: number, episode: number, airDate: string|null, rating: number|null}>} externalEpisodes
 * @returns {Map<string, number>} ratings keyed by "season:episode" in the add-on's numbering
 */
export function alignEpisodeRatings(
  addonEpisodes = [],
  externalEpisodes = [],
  today = localEpochDay()
) {
  const byNumber = new Map();
  externalEpisodes.forEach((entry) => {
    if (entry.rating != null) byNumber.set(key(entry.season, entry.episode), entry.rating);
  });

  const addonRegular = distinctSorted(
    addonEpisodes
      .map((entry) => ({
        season: toInteger(entry?.season),
        episode: toInteger(entry?.episode),
        released: entry?.released
      }))
      .filter((entry) => entry.season != null && entry.season > 0 && entry.episode != null)
      .map((entry) => ({
        season: entry.season,
        episode: entry.episode,
        day: parseAirDay(entry.released)
      }))
  );
  const externalRegular = distinctSorted(externalEpisodes.filter((entry) => entry.season > 0)).map(
    (entry) => ({
      season: entry.season,
      episode: entry.episode,
      day: parseAirDay(entry.airDate),
      rating: entry.rating
    })
  );

  if (!addonRegular.length || !externalRegular.length) return byNumber;
  const addonSeasons = new Set(addonRegular.map((entry) => entry.season));
  const externalSeasons = new Set(externalRegular.map((entry) => entry.season));
  if (
    addonSeasons.size === externalSeasons.size &&
    [...addonSeasons].every((season) => externalSeasons.has(season))
  ) {
    return byNumber;
  }

  const aired = (entry) => entry.day == null || entry.day <= today;
  const addonAired = addonRegular.filter(aired);
  const externalAired = externalRegular.filter(aired);
  if (addonAired.length === externalAired.length) {
    return buildAlignedRatings(
      byNumber,
      addonAired.map((entry, index) => [entry, externalAired[index]])
    );
  }

  const addonByDay = groupByDay(addonRegular);
  const externalByDay = groupByDay(externalRegular);
  if (!addonByDay.size || !externalByDay.size) return byNumber;

  const matches = [];
  addonByDay.forEach((sameDayAddon, day) => {
    const sameDayExternal =
      externalByDay.get(day) || externalByDay.get(day - 1) || externalByDay.get(day + 1);
    if (!sameDayExternal || sameDayExternal.length !== sameDayAddon.length) return;
    sameDayAddon.forEach((entry, index) => matches.push([entry, sameDayExternal[index]]));
  });
  return buildAlignedRatings(byNumber, matches);
}

function buildAlignedRatings(byNumber, matches) {
  const aligned = new Map();
  byNumber.forEach((rating, entryKey) => {
    if (entryKey.startsWith("0:")) aligned.set(entryKey, rating);
  });
  matches.forEach(([addon, external]) => {
    if (external.rating != null) aligned.set(key(addon.season, addon.episode), external.rating);
  });
  return aligned;
}

/** The add-on's own episode numbers and air dates, as Android maps meta.videos. */
export function addonEpisodeAirDates(videos = []) {
  return (Array.isArray(videos) ? videos : []).map((video) => ({
    season: video?.season ?? video?.seasonNumber ?? null,
    episode: video?.episode ?? video?.number ?? video?.episodeNumber ?? null,
    released: video?.released ?? null
  }));
}
