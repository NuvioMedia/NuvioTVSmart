function addIdentityValue(set, value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return;
  }
  set.add(normalized);
  set.add(normalized.toLowerCase());
}

function addPrefixedIdentityValue(set, prefix, value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(new RegExp(`^${prefix}:`, "i"), "");
  if (!normalized) {
    return;
  }
  addIdentityValue(set, `${prefix}:${normalized}`);
}

/**
 * Returns every stable catalog identity carried by a watched item or a catalog item.
 * The tracker payload and the catalog are allowed to choose different primary IDs;
 * callers must therefore compare this set instead of comparing only contentId.
 */
export function watchedItemIdentityValues(item = {}) {
  const values = new Set();
  const ids = item.ids || item.externalIds || item.external_ids || {};
  addIdentityValue(values, item.contentId);
  addIdentityValue(values, item.id);

  const imdbId = String(item.imdbId ?? "")
    .trim()
    .replace(/^imdb:/i, "");
  addIdentityValue(values, imdbId || item.imdb_id || ids.imdb);
  addPrefixedIdentityValue(values, "tmdb", item.tmdbId ?? item.tmdb_id ?? ids.tmdb);
  addPrefixedIdentityValue(values, "trakt", item.traktId ?? item.trakt_id ?? ids.trakt);
  addPrefixedIdentityValue(values, "tvdb", item.tvdbId ?? item.tvdb_id ?? ids.tvdb);
  addPrefixedIdentityValue(values, "mdblist", item.mdblistId ?? ids.mdblist);
  addIdentityValue(values, item.slug || item.ids?.slug || ids.slug);
  return values;
}

export function watchedItemsShareIdentity(left = {}, right = {}) {
  const rightIds = watchedItemIdentityValues(right);
  return Array.from(watchedItemIdentityValues(left)).some((id) => rightIds.has(id));
}
