function invalid() {
  throw Object.assign(new Error("mdblist_invalid_response"), { code: "mdblist_invalid_response" });
}
const positive = (value) =>
  Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
export function mdbListType(value) {
  const type = String(value || "").toLowerCase();
  return type === "movie"
    ? "movie"
    : ["show", "series", "tv", "anime"].includes(type)
      ? "series"
      : null;
}
export function readOnlyMdbListKey(key) {
  return /^mdblist:(dynamic|external|liked):[1-9]\d*$/.test(key);
}
export function mdbListItemsPath(key) {
  if (key === "mdblist:watchlist") return "/watchlist/items";
  const match = /^mdblist:(list|dynamic|external|liked):([1-9]\d*)$/.exec(key);
  if (!match) invalid();
  return `/${match[1] === "external" ? "external/lists" : "lists"}/${match[2]}/items`;
}
export function decodeMdbListTabs(rows, accountId, category) {
  if (!Array.isArray(rows)) invalid();
  const seen = new Set();
  return rows.flatMap((row) => {
    const type = row?.mediatype == null ? null : mdbListType(row.mediatype);
    if (!row || (row.mediatype != null && !type)) return [];
    if (category === "liked" && positive(row.user_id) === accountId) return [];
    if (["list", "dynamic"].includes(category)) {
      if (row.user_id != null && positive(row.user_id) !== accountId) return [];
      const dynamic = row.dynamic === true || row.type === "dynamic";
      if (category === "dynamic" ? !dynamic : row.type !== "static" || dynamic) return [];
    }
    const id =
      positive(row.id) ||
      (Array.isArray(row.ids) && row.ids.length === 1 ? positive(row.ids[0]) : null);
    if (
      !id ||
      typeof row.name !== "string" ||
      !row.name.trim() ||
      (category === "list" && typeof row.private !== "boolean")
    )
      invalid();
    if (seen.has(id)) {
      if (category === "liked") return [];
      invalid();
    }
    seen.add(id);
    return [
      {
        key: `mdblist:${category}:${id}`,
        title: row.name,
        type: category === "list" ? "personal" : "external",
        isMembershipDestination: category === "list",
        supportedContentTypes: type ? [type] : ["movie", "series"],
        trackingProviderId: "mdblist",
        privacy: row.private ? "private" : "public",
        description: row.description || row.source || null,
        updatedAt: row.last_updated_at || row.updated_at || row.updated || null
      }
    ];
  });
}
export function mdbListNextPage(payload, headers) {
  const page = payload?.pagination || payload || {};
  const cursor = page.next_cursor || headers?.get("X-Next-Cursor");
  if (cursor) return { cursor: String(cursor) };
  const offset = Number(page.offset),
    limit = Number(page.limit),
    total = Number(page.total);
  const hasMore =
    page.has_more ??
    (page.offset != null && page.limit != null && page.total != null && offset + limit < total);
  if (hasMore) {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      offset + limit > 2147483647
    )
      invalid();
    return { offset: String(offset + limit) };
  }
  if (String(headers?.get("X-Has-More")).toLowerCase() === "true") invalid();
  return null;
}
function image(value, size) {
  if (!value) return null;
  if (String(value).startsWith("/")) return `https://image.tmdb.org/t/p/${size}${value}`;
  return /^https?:\/\//i.test(value) ? value : null;
}
export function mdbListItemIds(row) {
  const nested = row?.ids || {};
  const imdb = nested.imdb ?? row.imdb_id;
  return {
    ...(imdb && /^tt\d+$/.test(imdb) ? { imdb } : {}),
    ...(nested.mdblist != null && String(nested.mdblist).trim()
      ? { mdblist: String(nested.mdblist).trim() }
      : {}),
    ...Object.fromEntries(
      ["tmdb", "tvdb", "trakt"].flatMap((key) => {
        const value = positive(nested[key] ?? (key === "tmdb" ? row.id : row[`${key}_id`]));
        return value ? [[key, value]] : [];
      })
    )
  };
}
export function decodeMdbListItems(payload) {
  let rows;
  if (Array.isArray(payload)) rows = payload.map((row) => [row, null]);
  else if (Array.isArray(payload?.items)) rows = payload.items.map((row) => [row, null]);
  else if (payload && ["movies", "shows", "seasons", "episodes"].some((key) => key in payload)) {
    rows = [
      ...(payload.movies || []).map((row) => [row, "movie"]),
      ...(payload.shows || []).map((row) => [row, "series"])
    ];
  } else invalid();
  return rows.flatMap(([row, bucket]) => {
    const declared = row.mediatype ?? row.type;
    if (["season", "episode"].includes(declared)) return [];
    const type = declared == null ? bucket : mdbListType(declared);
    if (!type || (bucket && type !== bucket)) invalid();
    const ids = mdbListItemIds(row);
    if (!Object.keys(ids).length) invalid();
    const id =
      ids.imdb ||
      (ids.tmdb
        ? `tmdb:${ids.tmdb}`
        : ids.tvdb
          ? `tvdb:${ids.tvdb}`
          : ids.trakt
            ? `trakt:${ids.trakt}`
            : `mdblist:${ids.mdblist}`);
    return [
      {
        id,
        type,
        ids,
        name: row.title || row.name || id,
        poster: image(row.poster, "w500"),
        background: image(row.backdrop || row.background, "w1280"),
        description: row.description || row.overview || "",
        genres: [
          ...new Set(
            (Array.isArray(row.genres) ? row.genres : [])
              .map((g) => (typeof g === "string" ? g : g?.name || g?.slug))
              .filter(Boolean)
          )
        ],
        listedAt: Date.parse(row.listed_at || row.added_at || row.watchlist_at || "") || 0,
        year: row.release_year || row.year || null,
        releaseDate: row.release_date || row.released || null,
        imdbId: ids.imdb || null,
        tmdbId: ids.tmdb || null,
        traktId: ids.trakt || null
      }
    ];
  });
}
export function projectMdbListEntries(snapshot) {
  // First resolve aliases across all lists. A TMDB-only row and a row containing
  // both TMDB and IMDb must project to one title, independently of list order.
  const aliases = new Map();
  const groups = new Set();
  for (const items of Object.values(snapshot.items || {}))
    for (const item of items) {
      const keys = Object.entries(item.ids).map(([key, id]) => `${item.type}:${key}:${id}`);
      const matches = [...new Set(keys.map((key) => aliases.get(key)).filter(Boolean))];
      const group = matches[0] || { ids: {}, items: [], keys: new Set() };
      groups.add(group);
      for (const other of matches.slice(1)) {
        group.items.push(...other.items);
        Object.assign(group.ids, other.ids);
        other.keys.forEach((key) => {
          group.keys.add(key);
          aliases.set(key, group);
        });
        groups.delete(other);
      }
      group.items.push(item);
      Object.assign(group.ids, item.ids);
      keys.forEach((key) => {
        aliases.set(key, group);
        group.keys.add(key);
      });
    }
  const entries = new Map();
  for (const [listKey, items] of Object.entries(snapshot.items || {})) {
    if (snapshot.hidden?.includes(listKey)) continue;
    items.forEach((item, rank) => {
      const [firstKey, firstId] = Object.entries(item.ids)[0];
      const group = aliases.get(`${item.type}:${firstKey}:${firstId}`);
      const ids = group.ids;
      const id =
        ids.imdb ||
        (ids.tmdb
          ? `tmdb:${ids.tmdb}`
          : ids.tvdb
            ? `tvdb:${ids.tvdb}`
            : ids.trakt
              ? `trakt:${ids.trakt}`
              : `mdblist:${ids.mdblist}`);
      const key = `${item.type}:${id}`;
      const previous = entries.get(key);
      entries.set(key, {
        ...item,
        id,
        ids,
        imdbId: ids.imdb || null,
        tmdbId: ids.tmdb || null,
        traktId: ids.trakt || null,
        name: group.items.find((i) => i.name && i.name !== i.id)?.name || item.name,
        poster: group.items.find((i) => i.poster)?.poster || null,
        background: group.items.find((i) => i.background)?.background || null,
        description: previous?.description || item.description || "",
        genres: [...new Set([...(previous?.genres || []), ...(item.genres || [])])],
        trackingProviderId: "mdblist",
        releaseInfo: String(item.year || ""),
        listKeys: [...new Set([...(previous?.listKeys || []), listKey])],
        listedAt: Math.max(previous?.listedAt || 0, item.listedAt),
        listMeta: {
          ...previous?.listMeta,
          [listKey]: { listedAt: item.listedAt, traktRank: rank }
        },
        traktRank: rank
      });
    });
  }
  return [...entries.values()];
}
