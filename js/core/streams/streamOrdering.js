const UNKNOWN_SOURCE_RANK = Number.MAX_SAFE_INTEGER;

function finiteSourceRank(value) {
  const rank = Number(value);
  return Number.isFinite(rank) && rank >= 0 && rank < UNKNOWN_SOURCE_RANK ? rank : null;
}

function normalizedName(value) {
  return String(value || "").trim();
}

function streamAddonOrderIndex(stream = {}) {
  return (
    finiteSourceRank(stream?.addonOrderIndex) ??
    finiteSourceRank(stream?.streamOrigin?.addonOrderIndex)
  );
}

function streamSourceKind(stream = {}) {
  const originKind = normalizedName(stream?.streamOrigin?.kind).toLowerCase();
  if (originKind) {
    return originKind;
  }
  return streamAddonOrderIndex(stream) != null ? "addon" : "plugin";
}

function streamSourceGroupKey(stream = {}, index = 0) {
  const origin = stream?.streamOrigin || {};
  const kind = streamSourceKind(stream);
  const identity =
    kind === "plugin"
      ? origin.sourceProviderId || stream.sourceProviderId || origin.addonName || stream.addonName
      : origin.addonId ||
        stream.addonId ||
        origin.addonBaseUrl ||
        stream.addonBaseUrl ||
        origin.addonName ||
        stream.addonName;
  return `${kind}:${normalizedName(identity) || `index-${index}`}`;
}

function buildAddonRanks(streams, sourceChips) {
  const ranks = new Map();
  const pluginNames = new Set(
    (Array.isArray(streams) ? streams : [])
      .filter((stream) => streamSourceKind(stream) === "plugin")
      .map((stream) => normalizedName(stream?.addonName))
      .filter(Boolean)
  );

  (Array.isArray(sourceChips) ? sourceChips : []).forEach((chip, index) => {
    const name = normalizedName(chip?.name);
    // Android keeps plugin groups in their arrival order; source chips are
    // also present for plugins, so they must not turn plugin names into
    // installed-addon ranks here.
    if (!name || pluginNames.has(name)) {
      return;
    }
    const rank = finiteSourceRank(chip?.orderIndex) ?? index;
    if (!ranks.has(name) || rank < ranks.get(name)) {
      ranks.set(name, rank);
    }
  });

  // A restored route can contain stream metadata before its source chips have
  // been rebuilt. Keep the explicit repository order as a safe fallback.
  (Array.isArray(streams) ? streams : []).forEach((stream) => {
    if (streamSourceKind(stream) === "plugin") {
      return;
    }
    const name = normalizedName(stream?.addonName);
    const rank = streamAddonOrderIndex(stream);
    if (name && rank != null && !ranks.has(name)) {
      ranks.set(name, rank);
    }
  });

  return ranks;
}

/**
 * Keep the source-group order used by Android TV while accepting Web's
 * progressive, completion-order stream emissions.
 *
 * Android orders direct-Debrid groups first, installed addon groups by their
 * saved order, and plugin groups last. Grouping the flattened Web items back
 * by their source identity also keeps a source's internal stream order intact.
 */
export function orderStreamsByAddonOrder(
  streams = [],
  sourceChips = [],
  { isDirectDebrid = () => false } = {}
) {
  const list = (Array.isArray(streams) ? streams : []).filter(Boolean);
  if (list.length <= 1) {
    return list.slice();
  }

  const addonRanks = buildAddonRanks(list, sourceChips);
  const groups = [];
  const groupsByKey = new Map();

  list.forEach((stream, index) => {
    const key = streamSourceGroupKey(stream, index);
    let group = groupsByKey.get(key);
    if (!group) {
      group = {
        firstIndex: index,
        items: [],
        isDirectDebrid: false
      };
      groupsByKey.set(key, group);
      groups.push(group);
    }
    group.items.push(stream);
    try {
      group.isDirectDebrid = group.isDirectDebrid || Boolean(isDirectDebrid(stream));
    } catch (_) {
      // A malformed resolver marker must not prevent the source list loading.
    }
  });

  const groupRank = (group) => {
    if (group.isDirectDebrid) {
      return { bucket: 0, rank: 0 };
    }
    const addonName = normalizedName(group.items[0]?.addonName);
    if (addonRanks.has(addonName)) {
      return { bucket: 1, rank: addonRanks.get(addonName) };
    }
    return { bucket: 2, rank: 0 };
  };

  groups.sort((left, right) => {
    const leftRank = groupRank(left);
    const rightRank = groupRank(right);
    if (leftRank.bucket !== rightRank.bucket) {
      return leftRank.bucket - rightRank.bucket;
    }
    if (leftRank.rank !== rightRank.rank) {
      return leftRank.rank - rightRank.rank;
    }
    return left.firstIndex - right.firstIndex;
  });

  return groups.flatMap((group) => group.items);
}

/**
 * Mirror Android's StreamProviderGrouping: keep add-on groups in their incoming order, group
 * each add-on's streams by plugin provider, sort those providers alphabetically, then flatten.
 */
export function groupStreamsByProvider(streams = []) {
  const addonGroups = new Map();
  (Array.isArray(streams) ? streams : []).filter(Boolean).forEach((stream) => {
    const addonName = normalizedName(stream?.addonName);
    const providerName = normalizedName(stream?.pluginSourceName) || addonName;
    let providers = addonGroups.get(addonName);
    if (!providers) {
      providers = new Map();
      addonGroups.set(addonName, providers);
    }
    if (!providers.has(providerName)) {
      providers.set(providerName, []);
    }
    providers.get(providerName).push(stream);
  });
  const compareProviderNames = (left, right) => {
    const a = String(left).toLowerCase();
    const b = String(right).toLowerCase();
    return a < b ? -1 : a > b ? 1 : 0;
  };
  return [...addonGroups.values()].flatMap((providers) =>
    [...providers.entries()]
      .sort(([left], [right]) => compareProviderNames(left, right))
      .flatMap(([, items]) => items)
  );
}

/**
 * Label to show above a stream card: the plugin provider, only when it is not the add-on name
 * and only at the boundary where it changes.
 */
export function streamProviderHeader(stream = {}, previous = null) {
  const providerName = normalizedName(stream?.pluginSourceName);
  if (!providerName || providerName === normalizedName(stream?.addonName)) {
    return "";
  }
  if (
    previous &&
    normalizedName(previous?.addonName) === normalizedName(stream?.addonName) &&
    normalizedName(previous?.pluginSourceName) === providerName
  ) {
    return "";
  }
  return providerName;
}

/**
 * Mirror Android's filter-row source names: sources with returned groups come
 * first in canonical group order, followed by configured sources with no
 * returned streams yet.
 */
export function orderSourceNames(
  streams = [],
  sourceChips = [],
  { isDirectDebrid = () => false } = {}
) {
  const ordered = [];
  orderStreamsByAddonOrder(streams, sourceChips, { isDirectDebrid }).forEach((stream) => {
    const name = normalizedName(stream?.addonName);
    if (name && !ordered.includes(name)) {
      ordered.push(name);
    }
  });

  (Array.isArray(sourceChips) ? sourceChips : [])
    .slice()
    .sort((left, right) => {
      const leftRank = finiteSourceRank(left?.orderIndex) ?? UNKNOWN_SOURCE_RANK;
      const rightRank = finiteSourceRank(right?.orderIndex) ?? UNKNOWN_SOURCE_RANK;
      return leftRank - rightRank;
    })
    .forEach((chip) => {
      const name = normalizedName(chip?.name);
      if (name && !ordered.includes(name)) {
        ordered.push(name);
      }
    });

  return ordered;
}
