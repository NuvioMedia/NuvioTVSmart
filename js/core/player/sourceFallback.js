import { selectAutoPlayStream } from "../streams/streamAutoPlaySelector.js";

// Android PlayerSettings source fallback bounds.
export const SOURCE_FALLBACK_MAX_SOURCES_DEFAULT = 3;
export const SOURCE_FALLBACK_MAX_SOURCES_MIN = 1;
export const SOURCE_FALLBACK_MAX_SOURCES_MAX = 10;
export const SOURCE_STARTUP_TIMEOUT_SECONDS_DEFAULT = 15;
export const SOURCE_STARTUP_TIMEOUT_SECONDS_MIN = 5;
export const SOURCE_STARTUP_TIMEOUT_SECONDS_MAX = 45;
export const SOURCE_STARTUP_TIMEOUT_SECONDS_STEP = 5;

/** Falling back applies only while auto source selection picks the stream. */
export function isSourceFallbackActive(settings = {}) {
  return (
    settings.streamAutoPlayFallbackOnFailure === true &&
    String(settings.streamAutoPlayMode || "MANUAL").toUpperCase() !== "MANUAL"
  );
}

function streamInfoHash(stream = {}) {
  return String(
    stream?.infoHash ||
      stream?.raw?.infoHash ||
      stream?.clientResolve?.infoHash ||
      stream?.raw?.clientResolve?.infoHash ||
      ""
  )
    .trim()
    .toLowerCase();
}

function streamFileIdx(stream = {}) {
  const value = [stream?.fileIdx, stream?.raw?.fileIdx, stream?.clientResolve?.fileIdx].find(
    (entry) => entry != null && entry !== "" && Number.isInteger(Number(entry))
  );
  return value == null ? -1 : Number(value);
}

/** Android Stream.sourceFallbackKey: one key across fresh, prepared and resolved copies of a source. */
export function sourceFallbackKey(stream = {}) {
  const addonName = String(stream?.addonName || "");
  const hash = streamInfoHash(stream);
  if (hash) {
    return `torrent:${addonName}:${hash}:${streamFileIdx(stream)}`;
  }
  const url = String(stream?.url || stream?.externalUrl || "").trim();
  if (url) {
    return `url:${url}`;
  }
  return `meta:${addonName}:${String(stream?.name || "")}:${String(stream?.description || "")}`;
}

/**
 * Android nextSourceFallbackCandidate: the stream auto source selection would pick,
 * leaving out the sources already tried and other copies of the torrent that failed.
 */
export function nextSourceFallbackCandidate({
  streams = [],
  settings = {},
  installedAddonNames = new Set(),
  triedKeys = new Set(),
  failedAddonName = "",
  failedInfoHash = ""
} = {}) {
  const failedHash = String(failedInfoHash || "").toLowerCase();
  const untried = (Array.isArray(streams) ? streams : []).filter(
    (stream) =>
      stream &&
      !stream.partyShared &&
      !triedKeys.has(sourceFallbackKey(stream)) &&
      !(failedHash && stream.addonName === failedAddonName && streamInfoHash(stream) === failedHash)
  );
  return (
    selectAutoPlayStream(untried, {
      mode: settings.streamAutoPlayMode,
      source: settings.streamAutoPlaySource,
      regexPattern: settings.streamAutoPlayRegex,
      installedAddonNames,
      selectedAddons: settings.streamAutoPlaySelectedAddons,
      selectedPlugins: settings.streamAutoPlaySelectedPlugins
    }) || null
  );
}
