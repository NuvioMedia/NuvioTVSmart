const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mkv",
  ".webm",
  ".avi",
  ".mov",
  ".m4v",
  ".ts",
  ".m2ts",
  ".wmv",
  ".flv"
]);

export function hasDebridVideoExtension(value) {
  const name = String(value || "")
    .trim()
    .toLowerCase();
  return Array.from(VIDEO_EXTENSIONS).some((extension) => name.endsWith(extension));
}

const DVD_IMAGE_EXTENSIONS = new Set([".iso", ".img", ".dvd", ".nrg", ".mdf", ".mds"]);

const DVD_VIDEO_EXTENSIONS = new Set([".vob", ".ifo", ".bup"]);

function fullFilePath(file = {}) {
  return [
    file.name,
    file.short_name,
    file.shortName,
    file.path,
    file.absolute_path,
    file.absolutePath
  ]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean)
    .join("\n");
}

export function isDvdImageFile(file = {}) {
  const name = displayName(file).toLowerCase();
  return Array.from(DVD_IMAGE_EXTENSIONS).some((extension) => name.endsWith(extension));
}

export function isDvdVideoFile(file = {}) {
  const name = displayName(file).toLowerCase();
  if (Array.from(DVD_VIDEO_EXTENSIONS).some((extension) => name.endsWith(extension))) {
    return true;
  }
  const fullPath = fullFilePath(file);
  return (
    fullPath.includes("/video_ts/") ||
    fullPath.includes("\\video_ts\\") ||
    fullPath.includes("/audio_ts/") ||
    fullPath.includes("\\audio_ts\\") ||
    fullPath.includes("/bdmv/") ||
    fullPath.includes("\\bdmv\\")
  );
}

export function getDvdPayloadKind(files = []) {
  const list = Array.isArray(files) ? files : [];
  if (!list.length) {
    return null;
  }
  if (list.some((file) => isDvdImageFile(file))) {
    return "iso";
  }
  if (list.some((file) => isDvdVideoFile(file))) {
    return "video_ts";
  }
  return null;
}

export function hasDvdOnlyPayload(files = [], kind = "") {
  const list = Array.isArray(files) ? files : [];
  if (!list.length) {
    return false;
  }
  if (list.some((file) => isPlayableVideo(file, kind))) {
    return false;
  }
  return getDvdPayloadKind(list) != null;
}

function displayName(file = {}) {
  return (
    String(
      file.name ||
        file.short_name ||
        file.shortName ||
        file.path ||
        file.absolute_path ||
        file.absolutePath ||
        ""
    )
      .split(/[\\/]/)
      .filter(Boolean)
      .pop() || ""
  );
}

function normalizedFileName(value) {
  return (
    String(value || "")
      .split(/[\\/]/)
      .filter(Boolean)
      .pop()
      ?.replace(/\.[^.]+$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim() || ""
  );
}

function buildEpisodePatterns(season, episode) {
  const seasonNumber = Number(season || 0);
  const episodeNumber = Number(episode || 0);
  if (seasonNumber <= 0 || episodeNumber <= 0) {
    return [];
  }
  const seasonTwo = String(seasonNumber).padStart(2, "0");
  const episodeTwo = String(episodeNumber).padStart(2, "0");
  return [
    `s${seasonTwo}e${episodeTwo}`,
    `${seasonNumber}x${episodeTwo}`,
    `${seasonNumber}x${episodeNumber}`
  ];
}

function looksSpecific(value, episodePatterns) {
  const lower = String(value || "").toLowerCase();
  return (
    hasDebridVideoExtension(lower) || episodePatterns.some((pattern) => lower.includes(pattern))
  );
}

function specificFileNames(resolve = {}, episodePatterns = []) {
  const raw = resolve.stream?.raw || {};
  return [
    resolve.filename,
    raw.filename,
    looksSpecific(raw.parsed?.rawTitle, episodePatterns) ? raw.parsed.rawTitle : null,
    looksSpecific(resolve.torrentName, episodePatterns) ? resolve.torrentName : null
  ]
    .map(normalizedFileName)
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
}

function isPlayableVideo(file = {}, kind = "") {
  const mime = String(file.mimetype || file.mimeType || file.mime_type || "").toLowerCase();
  if (mime.startsWith("video/")) {
    return true;
  }
  if (kind === "premiumize" && file.link && !displayName(file)) {
    return true;
  }
  return hasDebridVideoExtension(displayName(file));
}

function fileSize(file = {}) {
  return Number(file.size ?? file.bytes ?? 0) || 0;
}

export function selectDebridFile(
  files = [],
  resolve = {},
  { season = null, episode = null, kind = "" } = {}
) {
  const list = Array.isArray(files) ? files : [];
  const playable = list.filter((file) => isPlayableVideo(file, kind));
  if (!playable.length) {
    return null;
  }

  const episodePatterns = buildEpisodePatterns(
    season ?? resolve.season,
    episode ?? resolve.episode
  );
  const names = specificFileNames(resolve, episodePatterns);
  if (names.length) {
    const matched = playable.find((file) => {
      const normalized = normalizedFileName(displayName(file));
      return names.some((name) => normalized.includes(name) || name.includes(normalized));
    });
    if (matched) {
      return matched;
    }
  }

  if (episodePatterns.length) {
    const matched = playable.find((file) => {
      const name = displayName(file).toLowerCase();
      return episodePatterns.some((pattern) => name.includes(pattern));
    });
    if (matched) {
      return matched;
    }
  }

  if (resolve.fileIdx != null) {
    const fileIdx = Number(resolve.fileIdx);
    if (Number.isFinite(fileIdx)) {
      const byIndex = list[fileIdx];
      if (byIndex && isPlayableVideo(byIndex, kind)) {
        return byIndex;
      }
      const byOneBasedIndex = fileIdx > 0 ? list[fileIdx - 1] : null;
      if (byOneBasedIndex && isPlayableVideo(byOneBasedIndex, kind)) {
        return byOneBasedIndex;
      }
      const byId = playable.find((file) => String(file.id) === String(fileIdx));
      if (byId) {
        return byId;
      }
    }
  }

  return playable.reduce(
    (best, file) => (fileSize(file) > fileSize(best) ? file : best),
    playable[0]
  );
}

export function getDebridFileDisplayName(file = {}) {
  return displayName(file);
}

export function getDebridFileSize(file = {}) {
  return fileSize(file);
}
