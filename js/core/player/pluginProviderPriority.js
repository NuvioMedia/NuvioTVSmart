import { scraperIdFromPluginBingeGroup } from "../streams/pluginBingeGroup.js";

// Which plugin provider runs first, ported from Android core/plugin/PluginProviderPriority.kt.
// The provider a viewer plays most starts first; continuing a plugin series prefers the
// provider of the playing stream.

export function pluginProviderPlayStats(plays = []) {
  const stats = new Map();
  (Array.isArray(plays) ? plays : []).forEach((raw, index) => {
    const id = String(raw || "").trim();
    if (!id) {
      return;
    }
    const previous = stats.get(id);
    stats.set(id, {
      count: (previous?.count || 0) + 1,
      latestIndex: index
    });
  });
  return stats;
}

function mostPlayedProviderId(items, idOf, stats) {
  let favoriteId = null;
  let favoriteStat = null;
  items.forEach((item) => {
    const stat = stats.get(idOf(item));
    if (!stat) {
      return;
    }
    if (
      !favoriteStat ||
      stat.count > favoriteStat.count ||
      (stat.count === favoriteStat.count && stat.latestIndex > favoriteStat.latestIndex)
    ) {
      favoriteId = idOf(item);
      favoriteStat = stat;
    }
  });
  return favoriteId;
}

function preferredProviderId(items, idOf, priorityBingeGroup, stats) {
  const priorityId = scraperIdFromPluginBingeGroup(priorityBingeGroup);
  if (priorityId && items.some((item) => idOf(item) === priorityId)) {
    return priorityId;
  }
  return mostPlayedProviderId(items, idOf, stats);
}

export function orderForPluginPlayback(
  items = [],
  { id, priorityBingeGroup = null, stats = new Map() } = {}
) {
  const list = Array.isArray(items) ? items : [];
  if (list.length < 2 || typeof id !== "function") {
    return list;
  }
  const favoriteId = preferredProviderId(list, id, priorityBingeGroup, stats);
  if (!favoriteId) {
    return list;
  }
  const favoriteIndex = list.findIndex((item) => id(item) === favoriteId);
  if (favoriteIndex <= 0) {
    return list;
  }
  const ordered = list.slice();
  const [favorite] = ordered.splice(favoriteIndex, 1);
  ordered.unshift(favorite);
  return ordered;
}

export function preferredPluginProvider(
  items = [],
  { id, priorityBingeGroup = null, stats = new Map() } = {}
) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length || typeof id !== "function") {
    return null;
  }
  const favoriteId = preferredProviderId(list, id, priorityBingeGroup, stats);
  return favoriteId ? list.find((item) => id(item) === favoriteId) || null : null;
}

/**
 * For a next-episode search, `preferred` is the only provider to run first; `others`
 * run only if it returns nothing. A normal search leaves `preferred` empty and runs
 * every provider together.
 */
export function planPluginRun(
  items = [],
  { id, priorityBingeGroup = null, stats = new Map(), preferredOnly = false } = {}
) {
  const ordered = orderForPluginPlayback(items, { id, priorityBingeGroup, stats });
  if (!preferredOnly) {
    return { preferred: null, others: ordered };
  }
  const preferred = preferredPluginProvider(items, { id, priorityBingeGroup, stats });
  if (!preferred) {
    return { preferred: null, others: ordered };
  }
  return {
    preferred,
    others: ordered.filter((item) => id(item) !== id(preferred))
  };
}
