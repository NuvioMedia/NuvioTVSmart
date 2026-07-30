// Auto stream selection, ported from the Android TV app's StreamAutoPlaySelector
// and StreamAutoPlayPolicy so the two clients behave the same. Given the list of
// streams shown in the picker and the user's auto-play settings, it returns the
// stream that should play automatically, or null to leave the picker open.

export const STREAM_AUTO_PLAY_MODE = {
  MANUAL: "MANUAL",
  FIRST_STREAM: "FIRST_STREAM",
  REGEX_MATCH: "REGEX_MATCH"
};

export const STREAM_AUTO_PLAY_SOURCE = {
  ALL_SOURCES: "ALL_SOURCES",
  INSTALLED_ADDONS_ONLY: "INSTALLED_ADDONS_ONLY",
  ENABLED_PLUGINS_ONLY: "ENABLED_PLUGINS_ONLY"
};

function normalizeMode(value) {
  const mode = String(value || "")
    .trim()
    .toUpperCase();
  return STREAM_AUTO_PLAY_MODE[mode] ? mode : STREAM_AUTO_PLAY_MODE.MANUAL;
}

function normalizeSource(value) {
  const source = String(value || "")
    .trim()
    .toUpperCase();
  return STREAM_AUTO_PLAY_SOURCE[source] ? source : STREAM_AUTO_PLAY_SOURCE.ALL_SOURCES;
}

export function isRegexSelectionConfigured(regexPattern) {
  const pattern = String(regexPattern || "").trim();
  if (!pattern || !/[a-z0-9]/i.test(pattern)) {
    return false;
  }
  try {
    // eslint-disable-next-line no-new
    new RegExp(pattern, "i");
    return true;
  } catch (_) {
    return false;
  }
}

// Whether auto-play is active for these settings. Default mode MANUAL is off, so
// existing users see no change unless they opt in (or sync it from Android TV).
export function isAutoPlayEffectivelyEnabled(settings = {}) {
  const mode = normalizeMode(settings.streamAutoPlayMode);
  if (mode === STREAM_AUTO_PLAY_MODE.FIRST_STREAM) {
    return true;
  }
  if (mode === STREAM_AUTO_PLAY_MODE.REGEX_MATCH) {
    return isRegexSelectionConfigured(settings.streamAutoPlayRegex);
  }
  return false;
}

// A stream is auto-playable when it can actually start playback. External-url
// only entries (e.g. an addon's "open this website" cast link) are skipped so
// auto-play never lands on a non-video page.
function isPlayableStream(stream = {}) {
  const resolve = stream?.clientResolve || stream?.raw?.clientResolve || {};
  const debridState = String(stream?.debridCacheStatus?.state || "")
    .trim()
    .toUpperCase();
  if (["CHECKING", "NOT_CACHED", "UNKNOWN"].includes(debridState)) {
    return false;
  }
  return Boolean(
    stream &&
    (stream.url ||
      stream.ytId ||
      stream.infoHash ||
      resolve.infoHash ||
      resolve.magnetUri ||
      stream.engineFs ||
      stream.tizenP2p ||
      stream.debridCacheStatus)
  );
}

function streamBingeGroup(stream = {}) {
  return String(
    stream?.behaviorHints?.bingeGroup || stream?.raw?.behaviorHints?.bingeGroup || ""
  ).trim();
}

function streamSearchableText(stream = {}) {
  const parts = [stream.addonName, stream.name, stream.title, stream.description, stream.url];
  if (stream.infoHash) {
    parts.push(stream.infoHash);
  }
  return parts.map((part) => String(part || "")).join(" ");
}

function scopeStreamsBySource(streams, source, installedAddonNames) {
  const installed =
    installedAddonNames instanceof Set
      ? installedAddonNames
      : new Set(Array.isArray(installedAddonNames) ? installedAddonNames : []);
  if (source === STREAM_AUTO_PLAY_SOURCE.INSTALLED_ADDONS_ONLY) {
    return streams.filter((stream) => installed.has(String(stream.addonName || "")));
  }
  if (source === STREAM_AUTO_PLAY_SOURCE.ENABLED_PLUGINS_ONLY) {
    return streams.filter((stream) => !installed.has(String(stream.addonName || "")));
  }
  return streams;
}

// Extract excluded words from negative lookaheads like (?!.*(CAM|TS)) so a
// pattern can both include and exclude, matching the Android TV behaviour.
function buildExcludeRegex(pattern) {
  const matches = String(pattern || "").match(/\(\?![^)]*?\(([^)]+)\)/g) || [];
  const words = matches
    .map((match) => {
      const inner = /\(\?![^)]*?\(([^)]+)\)/.exec(match);
      return inner ? inner[1] : "";
    })
    .join("|")
    .split("|")
    .map((word) => word.trim())
    .filter(Boolean);
  if (!words.length) {
    return null;
  }
  try {
    return new RegExp(`\\b(${words.join("|")})\\b`, "i");
  } catch (_) {
    return null;
  }
}

export function selectAutoPlayStream(streams, options = {}) {
  const list = Array.isArray(streams) ? streams.filter(Boolean) : [];
  if (!list.length) {
    return null;
  }
  const mode = normalizeMode(options.mode);
  const source = normalizeSource(options.source);
  const installedAddonNames =
    options.installedAddonNames instanceof Set
      ? options.installedAddonNames
      : new Set(Array.isArray(options.installedAddonNames) ? options.installedAddonNames : []);
  const selectedAddons =
    options.selectedAddons instanceof Set
      ? options.selectedAddons
      : new Set(Array.isArray(options.selectedAddons) ? options.selectedAddons : []);
  const selectedPlugins =
    options.selectedPlugins instanceof Set
      ? options.selectedPlugins
      : new Set(Array.isArray(options.selectedPlugins) ? options.selectedPlugins : []);
  const candidates = scopeStreamsBySource(list, source, installedAddonNames).filter((stream) => {
    const addonName = String(stream?.addonName || "");
    const isAddonStream = installedAddonNames.has(addonName);
    return isAddonStream
      ? !selectedAddons.size || selectedAddons.has(addonName)
      : !selectedPlugins.size || selectedPlugins.has(addonName);
  });
  if (!candidates.length) {
    return null;
  }

  // Android gives an exact binge-group match priority over the normal mode,
  // including MANUAL. In bingeGroupOnly mode, a miss must open the picker.
  const preferredBingeGroup = String(options.preferredBingeGroup || "").trim();
  if (options.preferBingeGroupInSelection && preferredBingeGroup) {
    const bingeGroupMatch = candidates.find(
      (stream) => streamBingeGroup(stream) === preferredBingeGroup && isPlayableStream(stream)
    );
    if (bingeGroupMatch) {
      return bingeGroupMatch;
    }
    if (options.bingeGroupOnly) {
      return null;
    }
  }

  if (mode === STREAM_AUTO_PLAY_MODE.MANUAL) {
    return null;
  }

  if (mode === STREAM_AUTO_PLAY_MODE.FIRST_STREAM) {
    return candidates.find((stream) => isPlayableStream(stream)) || null;
  }

  // REGEX_MATCH
  const pattern = String(options.regexPattern || "").trim();
  let includeRegex;
  try {
    includeRegex = new RegExp(pattern, "i");
  } catch (_) {
    return null;
  }
  const excludeRegex = buildExcludeRegex(pattern);
  const match = candidates.find((stream) => {
    if (!isPlayableStream(stream)) {
      return false;
    }
    const text = streamSearchableText(stream);
    if (!includeRegex.test(text)) {
      return false;
    }
    if (excludeRegex && excludeRegex.test(text)) {
      return false;
    }
    return true;
  });
  return match || null;
}
