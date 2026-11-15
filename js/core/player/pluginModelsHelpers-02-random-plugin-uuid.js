/* eslint-disable no-unused-vars */

import {
  stablePluginHash,
  canonicalizePluginUrl,
  safePluginId,
  text,
  list,
  requiredManifestText,
  MAX_MANIFEST_SCRAPERS,
  validManifestStringList,
  optionalManifestStringList,
  resolvePluginUrl,
  PLUGIN_STATE_VERSION
} from "./pluginModelsHelpers-01-plugin-state-version.js";

export function randomPluginUuid() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    try {
      return cryptoApi.randomUUID();
    } catch (_) {
      // Fall through to the portable UUID implementation below.
    }
  }

  const bytes = new Uint8Array(16);
  if (typeof cryptoApi?.getRandomValues === "function") {
    try {
      cryptoApi.getRandomValues(bytes);
    } catch (_) {
      // Some older TV WebViews expose crypto but not getRandomValues.
    }
  }
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 0) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}

export function repositoryIdForUrl(url) {
  return `repo_${stablePluginHash(canonicalizePluginUrl(url))}`;
}

export function androidJsScraperId(repositoryId, manifestId) {
  const repository = String(repositoryId || "").trim() || "repository";
  const provider = String(manifestId || "").trim() || "scraper";
  return `${repository}:${provider}`;
}

export function scraperIdForManifest(repositoryId, manifestId, filename = "scraper") {
  const base = safePluginId(manifestId, safePluginId(filename, "scraper"));
  const suffix = stablePluginHash(`${manifestId || ""}\n${filename || ""}`);
  const prefix = `${safePluginId(repositoryId, "repo")}_`;
  const maxBaseLength = Math.max(1, 128 - prefix.length - suffix.length - 2);
  return `${prefix}${base.slice(0, maxBaseLength)}_${suffix}`;
}

// Android's Plugin.supportsType: series, show and other all mean "tv" on both
// sides, so a "series" scraper also serves the "tv" type used for TMDB lookups.
function normalizePluginType(value) {
  const type = text(value).toLowerCase();
  return type === "series" || type === "show" || type === "other" ? "tv" : type;
}

export function pluginSupportsType(supportedTypes, mediaType) {
  const raw = text(mediaType).toLowerCase();
  const target = normalizePluginType(raw);
  return list(supportedTypes).some((entry) => {
    const type = normalizePluginType(entry);
    // Smart keeps anime-only scrapers on "series" requests.
    return type === target || (raw === "series" && type === "anime");
  });
}

// Android's jsPluginMediaType: an episode request reaches a "series" scraper as
// "series", the type its getStreams() expects, instead of the TMDB "tv".
export function jsPluginMediaType(mediaType, supportedTypes, season, episode) {
  return text(mediaType).toLowerCase() === "tv" &&
    season != null &&
    episode != null &&
    list(supportedTypes).some((entry) => text(entry).toLowerCase() === "series")
    ? "series"
    : mediaType;
}

export function normalizePluginManifest(raw, manifestUrl = "") {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const name = requiredManifestText(raw.name);
  const version = requiredManifestText(raw.version);
  if (!name || !version || !Array.isArray(raw.scrapers)) {
    return null;
  }
  if ((raw.description != null && typeof raw.description !== "string") || (raw.author != null && typeof raw.author !== "string")) {
    return null;
  }
  const scrapers = raw.scrapers.slice(0, MAX_MANIFEST_SCRAPERS);
  const normalizedScrapers = [];
  const seen = new Set();
  let invalidScraper = false;
  scrapers.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      invalidScraper = true;
      return;
    }
    const id = requiredManifestText(entry.id);
    const scraperName = requiredManifestText(entry.name);
    const scraperVersion = requiredManifestText(entry.version);
    const filename = requiredManifestText(entry.filename);
    if (!id || !scraperName || !scraperVersion || !filename) {
      invalidScraper = true;
      return;
    }
    const supportedTypes = validManifestStringList(entry.supportedTypes, ["movie", "tv"]);
    const contentLanguage = optionalManifestStringList(entry.contentLanguage);
    const supportedPlatforms = optionalManifestStringList(entry.supportedPlatforms);
    const disabledPlatforms = optionalManifestStringList(entry.disabledPlatforms);
    const formats = optionalManifestStringList(entry.formats);
    if (
      !supportedTypes ||
      !contentLanguage ||
      !supportedPlatforms ||
      !disabledPlatforms ||
      !formats ||
      (entry.description != null && typeof entry.description !== "string") ||
      (entry.logo != null && typeof entry.logo !== "string") ||
      (entry.enabled !== undefined && typeof entry.enabled !== "boolean")
    ) {
      invalidScraper = true;
      return;
    }
    // Android treats the manifest id as the provider identity. Keep the first
    // declaration when a malformed manifest repeats that id with another
    // filename; otherwise the same provider could receive two user toggles.
    const key = id.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    normalizedScrapers.push({
      ...entry,
      id,
      name: scraperName,
      description: text(entry.description),
      version: scraperVersion,
      filename,
      supportedTypes,
      enabled: entry.enabled === undefined ? true : entry.enabled,
      logo: resolvePluginUrl(entry.logo, manifestUrl) || null,
      contentLanguage,
      supportedPlatforms,
      disabledPlatforms,
      formats,
      codeUrl: resolvePluginUrl(filename, manifestUrl)
    });
  });
  if (invalidScraper) {
    return null;
  }
  return {
    ...raw,
    name,
    version,
    description: text(raw.description),
    author: text(raw.author),
    scrapers: normalizedScrapers
  };
}

export function normalizeExternalRepositoryMetadata(raw, sourceUrl = "") {
  if (Array.isArray(raw)) {
    const plugins = raw.filter((entry) => entry && typeof entry === "object").slice(0, 512);
    if (!plugins.length) return null;
    return {
      name: text(sourceUrl.split("/").pop()?.split("?")[0], "CloudStream repository").replace(/\.json$/i, ""),
      description: "",
      manifestVersion: 1,
      pluginLists: [],
      plugins
    };
  }
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const pluginLists = Array.isArray(raw.pluginLists)
    ? raw.pluginLists.map((entry) => resolvePluginUrl(entry, sourceUrl)).filter(Boolean)
    : [];
  const plugins = Array.isArray(raw.plugins) ? raw.plugins.filter((entry) => entry && typeof entry === "object").slice(0, 512) : [];
  if (!pluginLists.length && !plugins.length) {
    return null;
  }
  return {
    ...raw,
    name: text(raw.name || raw.title, "CloudStream repository"),
    description: text(raw.description),
    manifestVersion: Number(raw.manifestVersion || 1) || 1,
    pluginLists,
    plugins
  };
}

export function createLegacySource(source = {}) {
  const url = text(source.urlTemplate || source.url || source.url_template);
  const explicitIdentity = text(source.id || source.name);
  const identity = url || explicitIdentity || stablePluginHash(JSON.stringify(source));
  return {
    ...source,
    id: `legacy_${stablePluginHash(identity)}`,
    name: text(source.name, "Legacy source"),
    urlTemplate: url,
    enabled: source.enabled !== false,
    source: "legacy-url-template",
    executable: false
  };
}

export function createDefaultPluginState() {
  return {
    schemaVersion: PLUGIN_STATE_VERSION,
    repositories: [],
    scrapers: [],
    settings: {
      pluginsEnabled: true,
      groupStreamsByRepository: false,
      scraperSettings: {}
    },
    legacySources: [],
    unknownRemoteRows: [],
    rawRemoteRows: [],
    syncDirty: false,
    runtime: {
      lastStatus: "unknown",
      lastError: "",
      lastCheckedAt: 0
    }
  };
}
