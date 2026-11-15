function normalizeHashes(hashes = []) {
  return (hashes || [])
    .map((hash) =>
      String(hash || "")
        .trim()
        .toLowerCase()
    )
    .filter(Boolean);
}

export function torboxCachedEntries(response = {}) {
  const data = response?.data?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {};
  }
  return Object.entries(data).reduce((entries, [hash, item]) => {
    const normalized = String(hash || "")
      .trim()
      .toLowerCase();
    if (normalized) {
      entries[normalized] = {
        name: item?.name || null,
        size: item?.size || null
      };
    }
    return entries;
  }, {});
}

// TorBox resolves a hash through its alternative-hash index and answers with the
// canonical hash as key, so an alias hit would otherwise read as a cache miss.
export async function resolveAlternativeHashMatches(
  cached = {},
  requestedHashes = [],
  fetchCached
) {
  const requested = normalizeHashes(requestedHashes);
  const aliased = Object.keys(cached || {}).some((hash) => !requested.includes(hash));
  if (!aliased) {
    return cached || {};
  }
  // One requested hash: every returned entry can only be its match.
  if (requested.length === 1) {
    const item = Object.values(cached || {})[0];
    return item ? { [requested[0]]: item } : {};
  }
  const resolved = { ...(cached || {}) };
  if (typeof fetchCached !== "function") {
    return resolved;
  }
  const missing = requested.filter((hash) => !resolved[hash]);
  const matches = await Promise.all(
    missing.map(async (hash) => {
      let single = null;
      try {
        single = await fetchCached(hash);
      } catch (_) {
        single = null;
      }
      return [hash, Object.values(single || {})[0] || null];
    })
  );
  matches.forEach(([hash, item]) => {
    if (item) {
      resolved[hash] = item;
    }
  });
  return resolved;
}
