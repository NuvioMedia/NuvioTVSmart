import { mdbListNextPage } from "./mdbListLibraryCodec.js";

export function invalidMdbTracking() {
  throw Object.assign(new Error("mdblist_invalid_response"), { code: "mdblist_invalid_response" });
}
export function mdbObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidMdbTracking();
  return value;
}
export function mdbArray(value) {
  if (!Array.isArray(value)) invalidMdbTracking();
  return value;
}
export function mdbTime(value) {
  if (typeof value !== "string") invalidMdbTracking();
  const match =
    /^(\d{4})-(\d\d)-(\d\d)([T ])(\d\d):(\d\d):(\d\d)(?:\.\d{1,9})?(Z|[+-]\d\d:\d\d)?$/.exec(value);
  if (!match || (match[4] === "T" && !match[8]) || (match[4] === " " && match[8]))
    invalidMdbTracking();
  const [, year, month, day, , hour, minute, second, zone] = match;
  const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number(year) < 100) calendar.setUTCFullYear(Number(year));
  if (
    Number(year) < 1 ||
    calendar.getUTCFullYear() !== Number(year) ||
    calendar.getUTCMonth() !== Number(month) - 1 ||
    calendar.getUTCDate() !== Number(day) ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59
  )
    invalidMdbTracking();
  if (zone && zone !== "Z") {
    const hours = Number(zone.slice(1, 3)),
      minutes = Number(zone.slice(4));
    if (hours > 18 || minutes > 59 || (hours === 18 && minutes !== 0)) invalidMdbTracking();
  }
  const time = Date.parse(match[4] === " " ? value.replace(" ", "T") + "Z" : value);
  if (!Number.isFinite(time)) invalidMdbTracking();
  return time;
}
function positiveId(value) {
  if (!["number", "string"].includes(typeof value) || !/^[1-9]\d*$/.test(String(value)))
    return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}
export function mdbPercentage(value) {
  if (!["number", "string"].includes(typeof value) || String(value).trim() === "")
    invalidMdbTracking();
  const progress = Number(value);
  if (!Number.isFinite(progress) || progress < 0 || progress > 100) invalidMdbTracking();
  return progress;
}
export function mdbIds(value) {
  const row = mdbObject(value),
    ids = mdbObject(row.ids ?? row),
    result = {};
  const imdb = ids.imdb ?? ids.imdbid;
  if (/^tt\d+$/.test(imdb || "")) result.imdb = imdb;
  for (const key of ["tmdb", "tvdb", "trakt"]) {
    const id = positiveId(ids[key] ?? ids[`${key}id`]);
    if (id) result[key] = id;
  }
  if (["string", "number"].includes(typeof ids.mdblist) && String(ids.mdblist).trim())
    result.mdblist = String(ids.mdblist).trim();
  if (!Object.keys(result).length) invalidMdbTracking();
  return result;
}
export function mdbAliases(ids) {
  return Object.entries(ids).flatMap(([key, value]) =>
    key === "imdb" ? [value, `imdb:${value}`] : [`${key}:${value}`]
  );
}
export function mdbMatches(left, right) {
  return Object.entries(left).some(([key, value]) => value === right[key]);
}
export function mdbContentId(ids) {
  return ids.imdb || mdbAliases(ids)[0];
}
function image(value, size) {
  if (typeof value !== "string") return null;
  if (value.startsWith("/") && !value.startsWith("//"))
    return `https://image.tmdb.org/t/p/${size}${value}`;
  return /^https?:\/\//.test(value) ? value : null;
}
export function mdbMedia(value) {
  const row = mdbObject(value);
  return {
    ids: mdbIds(row),
    title: row.title || row.name || null,
    year: row.year ?? null,
    poster: image(row.poster, "w500"),
    background: image(row.backdrop || row.background, "w1280"),
    runtime: positiveId(row.runtime) <= 2147483647 ? positiveId(row.runtime) || 0 : 0
  };
}
function coordinates(type, target, seasonOverride) {
  if (!["episode", "season"].includes(type)) return { season: null, episode: null };
  mdbObject(target);
  const season = seasonOverride ?? target.season ?? (type === "season" ? target.number : null);
  const episode = target.number ?? target.episode;
  if (
    !Number.isSafeInteger(season) ||
    season < 0 ||
    (type === "episode" && (!Number.isSafeInteger(episode) || episode < 1))
  )
    invalidMdbTracking();
  return { season, episode: type === "episode" ? episode : null };
}
export function mdbRecordMatches(left, right) {
  return (
    left.type === right.type &&
    mdbMatches(left.media.ids, right.media.ids) &&
    left.season === right.season &&
    left.episode === right.episode
  );
}
export function decodeMdbWatched(payload) {
  const p = mdbObject(payload),
    records = [];
  if (!["movies", "shows", "seasons", "episodes"].some((key) => key in p)) invalidMdbTracking();
  const add = (type, row, target, media, season) => {
    const at = row.last_watched_at ?? row.watched_at;
    if (at == null) return;
    records.push({
      type,
      media,
      ...coordinates(type, target, season),
      updatedAt: mdbTime(at),
      episodeTitle: type === "episode" ? target.title || target.name || null : null,
      episodeTmdbId: target.ids?.tmdb ?? null,
      episodeTvdbId: target.ids?.tvdb ?? null
    });
  };
  for (const type of ["movie", "show", "season", "episode"]) {
    for (const raw of mdbArray(p[`${type}s`] ?? [])) {
      const row = mdbObject(raw),
        target = mdbObject(row[type]);
      const media = mdbMedia(
        ["season", "episode"].includes(type) ? (row.show ?? target.show) : target
      );
      add(type, row, target, media);
      if (type === "show")
        for (const rawSeason of mdbArray(row.seasons ?? [])) {
          const season = mdbObject(rawSeason),
            number = season.number ?? season.season;
          if (!Number.isSafeInteger(number) || number < 0) invalidMdbTracking();
          for (const episode of mdbArray(season.episodes ?? []))
            add("episode", mdbObject(episode), episode, media, number);
        }
    }
  }
  return records;
}
export function decodeMdbPlayback(payload) {
  return mdbArray(payload).map((raw) => {
    const row = mdbObject(raw),
      type = row.type;
    if (!["movie", "episode"].includes(type)) invalidMdbTracking();
    const progress = mdbPercentage(row.progress),
      id = Number(row.id);
    if (
      row.progress == null ||
      !Number.isFinite(progress) ||
      progress < 0 ||
      progress > 100 ||
      !Number.isSafeInteger(id) ||
      id <= 0
    )
      invalidMdbTracking();
    return {
      type,
      id,
      media: mdbMedia(type === "movie" ? row.movie : (row.show ?? row.episode?.show)),
      ...coordinates(type, row.episode),
      progress,
      updatedAt: mdbTime(row.paused_at ?? row.updated_at),
      runtime: positiveId(row.runtime) <= 2147483647 ? positiveId(row.runtime) || 0 : 0,
      episodeTitle: row.episode?.title || null
    };
  });
}
export function decodeMdbDropped(payload, seasons = false) {
  const p = mdbObject(payload),
    key = seasons ? "seasons" : "shows";
  return mdbArray(p[key]).map((raw) => {
    const row = mdbObject(raw),
      target = mdbObject(row[seasons ? "season" : "show"]);
    return {
      ids: mdbIds(seasons ? (row.show ?? target.show) : target),
      season: seasons ? coordinates("season", target).season : null
    };
  });
}
export function decodeMdbActivities(payload) {
  const p = mdbObject(payload);
  if (!["watched_at", "episode_watched_at", "journal_at"].some((key) => key in p))
    invalidMdbTracking();
  mdbTime(p.server_time);
  for (const [key, value] of Object.entries(p))
    if (key.endsWith("_at") && value != null) mdbTime(value);
  return p;
}
export function decodeMdbJournal(payload) {
  const p = mdbObject(payload);
  if (p.requires_full_sync === true) return null;
  return mdbArray(p.journal).flatMap((raw) => {
    const row = mdbObject(raw);
    if (row.category === "rated") return [];
    if (
      row.category !== "watched" ||
      !["movie", "show", "season", "episode"].includes(row.item_type) ||
      !["added", "removed"].includes(row.status)
    )
      invalidMdbTracking();
    return [
      {
        type: row.item_type,
        media: { ids: mdbIds(row.ids) },
        ...coordinates(row.item_type, { season: row.season, episode: row.episode }),
        removed: row.status === "removed",
        actionAt: mdbTime(row.action_at),
        updatedAt: mdbTime(row.value_at ?? (row.status === "removed" ? row.action_at : null)),
        episodeTmdbId: row.episode_tmdb_id ?? null,
        episodeTvdbId: row.episode_tvdb_id ?? null
      }
    ];
  });
}
export async function mdbTrackingPages(api, path, decode, initial = {}) {
  let query = { ...initial, limit: "1000" },
    items = [];
  const visited = new Set();
  for (let page = 0; page < 1000; page++) {
    const key = JSON.stringify(query);
    if (visited.has(key)) invalidMdbTracking();
    visited.add(key);
    let response;
    try {
      response = await api(path, { query });
    } catch (error) {
      if (path === "/sync/journal" && error.status === 409) return null;
      throw error;
    }
    const decoded = decode(response.payload);
    if (decoded === null) return null;
    items.push(...decoded);
    const next = mdbListNextPage(response.payload, response.headers);
    if (!next) return items;
    if (path === "/sync/journal" && next.offset != null) invalidMdbTracking();
    query = { ...initial, limit: "1000", ...next };
    if (next.cursor) delete query.since;
  }
  invalidMdbTracking();
}

export function decodeMdbHistoryReceipt(payload, changes, remove) {
  const p = mdbObject(payload),
    counts = mdbObject(p[remove ? "deleted" : "updated"] ?? (remove ? p.removed : null));
  const failures = Object.values(mdbObject(p.not_found ?? {})).reduce((total, value) => {
    const count = Array.isArray(value) ? value.length : Number(value);
    if (!Number.isSafeInteger(count) || count < 0) invalidMdbTracking();
    return total + count;
  }, 0);
  const errors = mdbArray(p.errors ?? []).length;
  const expected = new Map();
  for (const { target } of changes)
    expected.set(`${target.type}s`, (expected.get(`${target.type}s`) || 0) + 1);
  const complete =
    failures === 0 &&
    errors === 0 &&
    [...expected].every(([key, count]) => Number(counts[key] || 0) >= count);
  let confirmed = [];
  if (!remove)
    confirmed = mdbArray(p.plays ?? []).map((raw) => {
      const row = mdbObject(raw),
        type = row.type;
      if (!["movie", "episode"].includes(type)) invalidMdbTracking();
      const ids = mdbIds(type === "movie" ? row : row.show);
      const coords = coordinates(type, { season: row.season, number: row.number ?? row.episode });
      const target = changes.find(
        (change) =>
          change.target.type === type &&
          mdbMatches(change.target.media.ids, ids) &&
          change.target.season === coords.season &&
          change.target.episode === coords.episode
      )?.target;
      if (!target) invalidMdbTracking();
      return {
        ...target,
        media: { ...target.media, ids: { ...target.media.ids, ...ids } },
        updatedAt: mdbTime(row.watched_at)
      };
    });
  if (!remove && confirmed.length === 0 && complete)
    confirmed = changes.map(({ target, item }) => ({
      ...target,
      updatedAt: mdbTime(new Date(item.watchedAt || Date.now()).toISOString())
    }));
  return {
    complete,
    confirmed,
    needsSnapshot: !complete || (!remove && confirmed.length !== changes.length)
  };
}
