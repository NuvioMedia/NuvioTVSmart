import { mediaServerRequest, serverEndpoint } from "./mediaBrowserClient.js";
import { withRequestTimeout } from "../../core/network/requestTimeout.js";
import { TmdbService } from "../../core/tmdb/tmdbService.js";

const indexes = new Map();
globalThis.document?.addEventListener?.("nuvio:media-servers-changed", () => indexes.clear());
const namespaces = ["imdb", "tmdb", "tvdb", "kitsu", "mal", "anilist", "anidb", "trakt", "simkl"];
export function watchedExternalIds(item = {}) {
  const source = item.ProviderIds || item.ids || item.externalIds || item.external_ids || {};
  const ids = {};
  for (const name of namespaces) {
    const entry = Object.entries(source).find(
      ([key]) =>
        (key.trim().toLowerCase() === "myanimelist" ? "mal" : key.trim().toLowerCase()) === name
    );
    const value = item[`${name}Id`] ?? item[`${name}_id`] ?? entry?.[1];
    if (value != null && (name === "imdb" ? /^tt\d+$/i : /^\d+$/).test(String(value)))
      ids[name] =
        name === "imdb" ? String(value).toLowerCase() : String(value).replace(/^0+(?=\d)/, "");
  }
  const match = String(item.videoId || item.contentId || item.id || "").match(
    /^(tt\d+|(?:tmdb|tvdb|kitsu|mal|anilist|anidb|trakt|simkl):\d+)(?::\d+:\d+)?$/i
  );
  if (match) {
    const [name, value] = match[1].toLowerCase().startsWith("tt")
      ? ["imdb", match[1]]
      : match[1].split(":");
    if (ids[name.toLowerCase()] && ids[name.toLowerCase()] !== value.toLowerCase()) return {};
    ids[name.toLowerCase()] = value.toLowerCase();
  }
  return ids;
}
export function externalIdsMatch(request, candidate) {
  const common = Object.keys(request).filter((name) => candidate[name] != null);
  return common.length > 0 && common.every((name) => request[name] === candidate[name]);
}
export function matchingEpisode(items, item) {
  const matches = (items || []).filter(
    (entry) =>
      !entry.IsMissing &&
      Number(entry.ParentIndexNumber) === Number(item.season) &&
      Number(entry.IndexNumber) === Number(item.episode) &&
      (entry.IndexNumberEnd == null || Number(entry.IndexNumberEnd) === Number(entry.IndexNumber))
  );
  if (matches.length !== 1) return null;
  const catalogDate = Date.parse(String(item.released || "").slice(0, 10));
  const serverDate = Date.parse(String(matches[0].PremiereDate || "").slice(0, 10));
  return Number.isFinite(catalogDate) &&
    Number.isFinite(serverDate) &&
    Math.abs(catalogDate - serverDate) > 2 * 86400000
    ? null
    : matches[0];
}
export async function findServerEpisode(connection, seriesId, item, signal) {
  const data = await mediaServerRequest(
    connection,
    `/Shows/${encodeURIComponent(seriesId)}/Episodes`,
    {
      query: {
        userId: connection.remoteUserId,
        season: item.season,
        fields: "PremiereDate",
        enableImages: false,
        enableUserData: false
      },
      signal
    }
  );
  return matchingEpisode(data?.Items, item);
}
async function convertedIds(item) {
  const ids = watchedExternalIds(item);
  if (!ids.imdb && !ids.tmdb) return ids;
  let timer;
  try {
    const conversion =
      ids.imdb && !ids.tmdb
        ? TmdbService.ensureTmdbId(ids.imdb, item.episode == null ? "movie" : "series", {
            requireEnabled: false
          }).then((id) => ["tmdb", id])
        : ids.tmdb && !ids.imdb
          ? TmdbService.tmdbToImdb(
              Number(ids.tmdb),
              item.episode == null ? "movie" : "series"
            ).then((id) => ["imdb", id])
          : Promise.resolve(null);
    const entry = await Promise.race([
      conversion.catch(() => null),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), 5000);
      })
    ]);
    if (entry?.[1]) Object.assign(ids, watchedExternalIds({ [`${entry[0]}Id`]: entry[1] }));
  } finally {
    clearTimeout(timer);
  }
  return ids;
}
// Resolve every selected library before making any write. A truncated or failed
// lookup must never produce a partial mirror, and cached catalog refs are not proof.
export async function mirrorWatchTargets(connections, item) {
  const episode = item.episode != null;
  if (
    episode &&
    (item.season == null ||
      !Number.isInteger(Number(item.season)) ||
      Number(item.season) < 0 ||
      !Number.isInteger(Number(item.episode)) ||
      Number(item.episode) < 1)
  )
    return [];
  if (!episode && !["movie", "film"].includes(String(item.contentType || item.type).toLowerCase()))
    return [];
  connections = connections.filter(
    (entry) =>
      entry.enabled &&
      entry.useCatalogMetadata &&
      (entry.libraries || []).some(
        (lib) => lib.selected && [episode ? "series" : "movie", "mixed"].includes(lib.kind)
      )
  );
  if (!connections.length) return [];
  const ids = await convertedIds(item);
  if (!Object.keys(ids).length) return [];
  return withRequestTimeout(async (signal) => {
    const targets = new Map();
    for (const connection of connections.filter(
      (entry) => entry.enabled && entry.useCatalogMetadata
    )) {
      const kind = episode ? "series" : "movie";
      for (const library of (connection.libraries || []).filter(
        (entry) => entry.selected && [kind, "mixed"].includes(entry.kind)
      )) {
        const cacheKey = JSON.stringify([connection, library.id, kind]);
        let cached = indexes.get(cacheKey);
        if (!cached || Date.now() - cached.created > 600000) {
          const promise = (async () => {
            const entries = [];
            const seen = new Set();
            for (let startIndex = 0; ; startIndex += 500) {
              const endpoint = serverEndpoint(connection, "items");
              const data = await mediaServerRequest(connection, endpoint.path, {
                signal,
                query: {
                  ...endpoint.query,
                  parentId: library.id,
                  recursive: true,
                  includeItemTypes: episode ? "Series" : "Movie",
                  fields: "ProviderIds",
                  enableImages: false,
                  enableUserData: false,
                  enableTotalRecordCount: true,
                  startIndex,
                  limit: 500
                }
              });
              if (!Array.isArray(data?.Items)) throw new Error("servers_watched_failed");
              for (const candidate of data.Items) {
                if (!candidate.Id || seen.has(candidate.Id))
                  throw new Error("servers_watched_failed");
                seen.add(candidate.Id);
                entries.push(candidate);
              }
              if (
                data.Items.length < 500 ||
                (data.TotalRecordCount != null &&
                  startIndex + data.Items.length >= data.TotalRecordCount)
              )
                return entries;
            }
          })();
          cached = { promise, created: Date.now() };
          indexes.set(cacheKey, cached);
          promise.catch(() => {
            if (indexes.get(cacheKey) === cached) indexes.delete(cacheKey);
          });
        }
        const entries = await cached.promise;
        for (const candidate of entries) {
          if (candidate.IsMissing || !externalIdsMatch(ids, watchedExternalIds(candidate)))
            continue;
          const match = episode
            ? await findServerEpisode(connection, candidate.Id, item, signal)
            : candidate;
          if (match?.Id)
            targets.set(`${connection.id}:${match.Id}`, {
              connectionId: connection.id,
              itemId: match.Id
            });
        }
      }
    }
    return [...targets.values()];
  }, 12000);
}
