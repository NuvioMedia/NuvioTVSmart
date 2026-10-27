import { PluginStore, getEffectivePluginProfileId } from "../../data/local/pluginStore.js";
import { PluginCodeStore } from "../../data/local/pluginCodeStore.js";
import { ProfileManager } from "../profile/profileManager.js";
import { PluginRuntime } from "./pluginRuntime.js";
import { PluginExecutionFlight } from "./pluginExecutionFlight.js";
import { PluginServiceClient } from "../../platform/pluginServiceClient.js";
import { Platform } from "../../platform/index.js";
import { getPluginCapabilitySnapshot } from "./pluginPolicy.js";
import {
  canonicalizePluginUrl,
  androidJsScraperId,
  isExecutablePluginRepository,
  isExecutableScraper,
  normalizeExternalRepositoryMetadata,
  normalizePluginManifest,
  normalizePluginRepositoryType,
  normalizePluginState,
  pluginSupportsType,
  randomPluginUuid,
  resolvePluginUrl,
  isPluginShortCode,
  isVideoEasyScraper,
  isExternalDexRepository,
  sanitizePluginRepositoryInput,
  scraperIdForManifest,
  stablePluginHash,
  PLUGIN_REPOSITORY_TYPES
} from "./pluginModels.js";
import { PLUGIN_QUOTAS } from "./pluginPolicy.js";
import { validatePluginUrl } from "./pluginSecurity.js";
import { I18n } from "../../i18n/index.js";
import { emitPluginDiagnosticEvent } from "../diagnostics/pluginDiagnostics.js";

const singleFlight = new PluginExecutionFlight();
const queuedExecutions = [];
let runningExecutions = 0;
let runtimeReadyPromise = null;
let reconcileTail = Promise.resolve();
export const ANDROID_PLUGIN_MANAGEMENT_USER_AGENT = "NuvioTV/1.0";

function withReconcileLock(task) {
  const previous = reconcileTail;
  let current = null;
  current = previous
    .catch(() => {})
    .then(task)
    .finally(() => {
      if (reconcileTail === current) {
        reconcileTail = Promise.resolve();
      }
    });
  reconcileTail = current;
  return current;
}

function currentState(profileId = null) {
  return normalizePluginState(profileId == null ? PluginStore.get() : PluginStore.get(profileId));
}

function diagnosticError(error) {
  const details = {
    name: String(error?.name || "Error"),
    message: String(error?.message || error || "Unknown error")
  };
  if (error?.code) details.code = String(error.code);
  if (error?.stack) details.stack = String(error.stack).slice(0, 1200);
  return details;
}

function diagnosticUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return `${parsed.origin}${parsed.pathname}`;
  } catch (_) {
    return raw.split(/[?#]/, 1)[0].slice(0, 240);
  }
}

function diagnosticRepository(repository = {}) {
  let keys = [];
  try {
    keys = Object.keys(repository).sort().slice(0, 40);
  } catch (_) {
    keys = [];
  }
  return {
    id: repository?.id == null ? "" : String(repository.id).slice(0, 128),
    name: repository?.name == null ? "" : String(repository.name).slice(0, 120),
    url: diagnosticUrl(repository?.url || repository?.url_template || repository?.urlTemplate),
    type: repository?.repoType ?? repository?.repo_type ?? repository?.type ?? null,
    repoTypeDeclared: repository?.repoTypeDeclared === true,
    enabled: repository?.enabled,
    keys
  };
}

function diagnosticState(state = {}) {
  return {
    syncDirty: state.syncDirty === true,
    repositoryCount: Array.isArray(state.repositories) ? state.repositories.length : 0,
    scraperCount: Array.isArray(state.scrapers) ? state.scrapers.length : 0,
    unknownRemoteRowsCount: Array.isArray(state.unknownRemoteRows)
      ? state.unknownRemoteRows.length
      : 0,
    repositories: (Array.isArray(state.repositories) ? state.repositories : [])
      .slice(0, 64)
      .map(diagnosticRepository),
    unknownRemoteRows: (Array.isArray(state.unknownRemoteRows) ? state.unknownRemoteRows : [])
      .slice(0, 64)
      .map(diagnosticRepository)
  };
}

// Keep successful reconciliation/download state quiet. Failure and warning
// events go through console.warn/error so they remain visible both in the TV
// Inspector and in the in-app Settings > Console debug screen.
function logPluginDiagnostic(event, details = {}) {
  emitPluginDiagnosticEvent(event, details, { prefix: "[Nuvio PluginManager]" });
}

function canEdit(profileId = null) {
  return PluginStore.canEdit(profileId == null ? undefined : profileId);
}

function cloudRepositoryFingerprint(state) {
  return JSON.stringify({
    repositories: (state.repositories || []).map((repository) => ({
      url: isExternalDexRepository(repository)
        ? canonicalizePluginUrl(repository.url)
        : canonicalizePluginUrl(repository.url, { manifest: true }),
      enabled: repository.enabled !== false,
      type: isExternalDexRepository(repository)
        ? PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX
        : normalizePluginRepositoryType(repository.type)
    })),
    unknownRemoteRows: state.unknownRemoteRows || []
  });
}

function mergeLocalOnlyChanges(initialState, reconciledState, currentStateValue) {
  const initialScrapers = new Map((initialState.scrapers || []).map((entry) => [entry.id, entry]));
  const currentScrapers = new Map(
    (currentStateValue.scrapers || []).map((entry) => [entry.id, entry])
  );
  const scrapers = (reconciledState.scrapers || []).map((entry) => {
    const initial = initialScrapers.get(entry.id);
    const current = currentScrapers.get(entry.id);
    return initial && current && current.enabled !== initial.enabled
      ? { ...entry, enabled: current.enabled }
      : entry;
  });
  return {
    ...reconciledState,
    settings: currentStateValue.settings,
    legacySources: currentStateValue.legacySources,
    runtime: currentStateValue.runtime,
    scrapers,
    syncDirty: currentStateValue.syncDirty
  };
}

function platformId() {
  return Platform.getName();
}

function executableScrapersForMediaType(state, mediaType) {
  const repositoriesById = new Map((state.repositories || []).map((entry) => [entry.id, entry]));
  return (state.scrapers || []).filter((scraper) => {
    const repository = repositoriesById.get(scraper.repositoryId);
    return (
      isExecutableScraper(scraper, repository, platformId()) &&
      scraper.codeAvailable !== false &&
      pluginSupportsType(scraper.supportedTypes, mediaType)
    );
  });
}

function quotaFor(capabilities = getPluginCapabilitySnapshot()) {
  return capabilities.quota || PLUGIN_QUOTAS.limited;
}

function markRuntime(status, error = "") {
  const state = currentState();
  PluginStore.replace({
    ...state,
    runtime: {
      ...state.runtime,
      lastStatus: status,
      lastError: String(error || ""),
      lastCheckedAt: Date.now()
    }
  });
}

function normalizeStreamUrl(value, { rejectObjectMarker = true } = {}) {
  const url = String(value ?? "");
  return !url.trim() || (rejectObjectMarker && url.includes("[object")) ? "" : url;
}

function parseQualityValue(value) {
  const lower = String(value || "").toLowerCase();
  if (!lower) return -1;
  if (lower.includes("4k") || lower.includes("2160")) return 2160;
  if (lower.includes("1080")) return 1080;
  if (lower.includes("800")) return 800;
  if (lower.includes("720")) return 720;
  if (lower.includes("480")) return 480;
  if (lower.includes("360")) return 360;
  return -1;
}

function pluginDescription(result = {}) {
  const parts = [androidResultString(result.size), androidResultString(result.language)].filter(
    (value) => value !== null
  );
  return parts.length ? parts.join(" • ") : null;
}

function urlResultValue(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return typeof value.url === "string" ? value.url : "";
  }
  return "";
}

function normalizePluginSubtitles(value) {
  return (Array.isArray(value) ? value : [])
    .map((subtitle) => {
      if (!subtitle || typeof subtitle !== "object") return null;
      const url = androidResultString(subtitle.url);
      if (!url || !url.trim()) return null;
      const lang =
        androidResultString(subtitle.language) || androidResultString(subtitle.lang) || "Unknown";
      const headers = subtitle.headers || subtitle.behaviorHints?.proxyHeaders?.request;
      return {
        id: androidResultString(subtitle.id) || url,
        url,
        lang,
        ...(headers ? { headers } : {}),
        addonName: androidResultString(subtitle.name) || "Plugin",
        addonLogo: null,
        isStreamProvided: true
      };
    })
    .filter(Boolean);
}

function normalizePluginResultHeaders(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const stringHeaders = {};
  Object.entries(value).forEach(([key, headerValue]) => {
    if (typeof key === "string" && typeof headerValue === "string") {
      stringHeaders[key] = headerValue;
    }
  });
  if (!Object.keys(stringHeaders).length) return null;
  return Object.keys(stringHeaders).length ? stringHeaders : null;
}

function androidJavaString(value) {
  if (value == null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((entry) => androidJavaString(entry)).join(", ")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .map(([key, entry]) => `${key}=${androidJavaString(entry)}`)
      .join(", ")}}`;
  }
  return String(value);
}

export function androidResultString(value) {
  if (value == null) return null;
  const text = androidJavaString(value);
  return text.includes("[object") ? null : text;
}

function unknownQualityLabel() {
  try {
    return I18n.t("stream_quality_unknown", {}, { fallback: "Unknown" });
  } catch (_) {
    return "Unknown";
  }
}

export function resultToStream(result = {}, scraper = {}) {
  // Android's LocalScraperResult contract has one URL field. Keep the Web
  // adapter compatible with that contract instead of accepting alternate
  // fields that Android would discard.
  const urlValue = urlResultValue(result.url);
  const url = normalizeStreamUrl(urlValue, {
    // Android rejects the string form of a JavaScript object marker, but its
    // Map<String, Any> URL branch only checks that the mapped value is a
    // non-blank String. Preserve that small branch distinction.
    rejectObjectMarker: typeof result.url === "string"
  });
  if (!url) return null;
  const qualityValue = androidResultString(result.quality);
  const quality = qualityValue && qualityValue.trim() ? qualityValue : null;
  // Android first materializes a nullable title into LocalScraperResult,
  // falling back to name and finally to "Unknown". Blank strings remain blank
  // until the later stream projection, where the scraper name is used.
  const parsedTitle = androidResultString(result.title);
  const parsedName = androidResultString(result.name);
  const parserTitle = parsedTitle ?? parsedName ?? "Unknown";
  const baseTitle = parserTitle.trim() ? parserTitle : null;
  const baseName = parsedName?.trim() ? parsedName : null;
  const displayNameBase = baseName || baseTitle || scraper.name;
  const qualityLabel = quality || unknownQualityLabel();
  const name = `${displayNameBase}${String(displayNameBase).includes(qualityLabel) ? "" : ` - ${qualityLabel}`}`;
  const displayTitle = baseTitle || baseName || scraper.name;
  const resultHeaders = normalizePluginResultHeaders(result.headers);
  return {
    title: displayTitle,
    name,
    url,
    description: pluginDescription(result),
    quality,
    qualityValue: parseQualityValue(quality),
    infoHash: androidResultString(result.infoHash),
    addonName: scraper.name,
    addonLogo: null,
    behaviorHints: resultHeaders
      ? {
          notWebReady: null,
          bingeGroup: null,
          countryWhitelist: null,
          proxyHeaders: { request: resultHeaders, response: null }
        }
      : null,
    subtitles: normalizePluginSubtitles(result.subtitles)
  };
}

async function mergeRepositoryScrapers(state, repository, manifest, profileId = null) {
  const previous = state.scrapers.filter((entry) => entry.repositoryId === repository.id);
  const previousByKey = new Map(
    previous.map((entry) => [`${entry.manifestId || entry.filename}`, entry])
  );
  logPluginDiagnostic("JS repository scraper merge begin", {
    profileId: profileId == null ? "" : String(profileId),
    repository: diagnosticRepository(repository),
    manifestScraperCount: Array.isArray(manifest?.scrapers) ? manifest.scrapers.length : 0,
    previousScraperCount: previous.length
  });
  const scrapers = await Promise.all(
    manifest.scrapers.map(async (entry) => {
      const old = previousByKey.get(`${entry.id}`) || previousByKey.get(`${entry.filename}`) || {};
      // Android identifies a new Nuvio JS scraper as repository UUID plus
      // manifest id. Keep an existing Smart id when refreshing so its code
      // cache and per-scraper settings remain addressable.
      const id = old.id || androidJsScraperId(repository.id, entry.id);
      return {
        ...entry,
        id,
        repositoryId: repository.id,
        manifestId: entry.id,
        type: PLUGIN_REPOSITORY_TYPES.NUVIO_JS,
        // Android keeps an existing user choice, but newly discovered
        // VideoEasy providers start disabled until the user confirms the risk.
        enabled:
          old.enabled !== undefined
            ? old.enabled
            : entry.enabled !== false && !isVideoEasyScraper(entry.id, entry.name, entry.filename),
        manifestEnabled: entry.enabled !== false,
        codeAvailable: Boolean(await PluginCodeStore.get(id, profileId)),
        codeUrl: resolvePluginUrl(entry.codeUrl || entry.filename, repository.url),
        supportedPlatforms: entry.supportedPlatforms || [],
        disabledPlatforms: entry.disabledPlatforms || []
      };
    })
  );
  logPluginDiagnostic("JS repository scraper merge complete", {
    profileId: profileId == null ? "" : String(profileId),
    repository: diagnosticRepository(repository),
    scraperCount: scrapers.length,
    cachedScraperCount: scrapers.filter((entry) => entry.codeAvailable).length
  });
  return {
    ...state,
    repositories: [
      ...state.repositories.filter((entry) => entry.id !== repository.id),
      {
        ...repository,
        type: PLUGIN_REPOSITORY_TYPES.NUVIO_JS,
        scraperCount: scrapers.length,
        lastUpdated: Date.now(),
        metadata: manifest
      }
    ],
    scrapers: [
      ...state.scrapers.filter((entry) => entry.repositoryId !== repository.id),
      ...scrapers
    ]
  };
}

async function fetchJson(url, quota) {
  const response = await PluginServiceClient.fetch({
    url,
    method: "GET",
    headers: { Accept: "application/json", "User-Agent": ANDROID_PLUGIN_MANAGEMENT_USER_AGENT },
    timeoutMs: quota.providerTimeoutMs,
    maxBodyBytes: quota.maxManifestBytes
  });
  if (!response.ok || response.truncated) {
    throw new Error(`Plugin manifest request failed (${response.status || 0})`);
  }
  try {
    return JSON.parse(response.body || "{}");
  } catch (_) {
    throw new Error("Plugin manifest is not valid JSON");
  }
}

function isJsonEndpoint(url) {
  try {
    return /\.json$/i.test(new URL(url).pathname);
  } catch (_) {
    return /\.json(?:[?#].*)?$/i.test(String(url || ""));
  }
}

function isExplicitExternalJsonEndpoint(url) {
  try {
    const pathname = new URL(url).pathname;
    return /\.json$/i.test(pathname) && !/\/manifest\.json$/i.test(pathname);
  } catch (_) {
    return false;
  }
}

function repositoryManifestCandidates(url) {
  const normalized = canonicalizePluginUrl(url);
  if (!normalized) return [];
  const candidates = isJsonEndpoint(normalized)
    ? [normalized]
    : [canonicalizePluginUrl(normalized, { manifest: true }), normalized];
  return candidates.filter(
    (candidate, index) => candidate && candidates.indexOf(candidate) === index
  );
}

function repositoryIdentity(url) {
  const normalized = canonicalizePluginUrl(url);
  if (!normalized) return "";
  return (
    isJsonEndpoint(normalized) ? normalized : canonicalizePluginUrl(normalized, { manifest: true })
  ).toLowerCase();
}

function remoteRepositoryTypeHint(remote = {}) {
  const url = canonicalizePluginUrl(remote?.url || remote?.url_template || remote?.urlTemplate);
  if (/\.cs3(?:$|[?#])/i.test(url)) {
    return PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX;
  }
  const declaredType = remote?.repoType ?? remote?.repo_type ?? remote?.type;
  const hasExplicitType = remote?.repoTypeDeclared === true || declaredType != null;
  if (!hasExplicitType) return null;
  const normalizedType = normalizePluginRepositoryType(
    declaredType,
    PLUGIN_REPOSITORY_TYPES.UNKNOWN
  );
  // Android's RepositoryType.valueOf() returns no usable hint for empty or
  // future enum values, so reconciliation falls back to auto-detection.
  // Smart TV must not turn a valid JS manifest into a permanently opaque row
  // merely because an older/newer client wrote an unrecognised repo_type.
  return normalizedType === PLUGIN_REPOSITORY_TYPES.UNKNOWN ? null : normalizedType;
}

async function fetchRepositoryDocument(url, quota) {
  let lastError = null;
  for (const candidate of repositoryManifestCandidates(url)) {
    try {
      return { document: await fetchJson(candidate, quota), sourceUrl: candidate };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Repository manifest could not be loaded");
}

function delayWithSignal(milliseconds, signal) {
  const delay = Math.max(0, Number(milliseconds) || 0);
  if (!delay || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    let timer = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener?.("abort", finish);
      resolve();
    };
    timer = setTimeout(finish, delay);
    signal?.addEventListener?.("abort", finish, { once: true });
  });
}

async function resolvePluginShortCode(code) {
  const normalizedCode = String(code || "").trim();
  if (!isPluginShortCode(normalizedCode)) return null;
  const shortUrl = `https://cutt.ly/${encodeURIComponent(normalizedCode)}`;
  try {
    const response = await PluginServiceClient.fetch({
      url: shortUrl,
      method: "GET",
      headers: {
        Accept: "text/html, application/xhtml+xml",
        "User-Agent": ANDROID_PLUGIN_MANAGEMENT_USER_AGENT
      },
      timeoutMs: quotaFor().providerTimeoutMs,
      maxBodyBytes: 16 * 1024,
      maxResponseBytes: 16 * 1024
    });
    const resolvedUrl = sanitizePluginRepositoryInput(response.url);
    if (response.ok && resolvedUrl && resolvedUrl !== shortUrl) return resolvedUrl;
  } catch (error) {
    logPluginDiagnostic("plugin short-code resolution failed", {
      shortCode: normalizedCode,
      url: shortUrl,
      error: diagnosticError(error)
    });
  }
  return null;
}

async function loadExternalMetadata(document, sourceUrl, quota) {
  const initial = normalizeExternalRepositoryMetadata(document, sourceUrl);
  if (!initial) return null;
  const entries = [...(Array.isArray(initial.plugins) ? initial.plugins : [])];
  const listUrls = (Array.isArray(initial.pluginLists) ? initial.pluginLists : [])
    .filter((entry, index, values) => values.indexOf(entry) === index)
    .filter((entry) => !/\.cs3(?:$|[?#])/i.test(entry))
    .slice(0, 8);
  for (const listUrl of listUrls) {
    try {
      const listDocument = await fetchJson(listUrl, quota);
      if (Array.isArray(listDocument)) entries.push(...listDocument);
      else if (Array.isArray(listDocument?.plugins)) entries.push(...listDocument.plugins);
    } catch (error) {
      logPluginDiagnostic("external metadata list refresh failed", {
        url: listUrl,
        error: diagnosticError(error)
      });
    }
  }
  const seen = new Set();
  const plugins = entries
    .filter((entry) => entry && typeof entry === "object")
    .filter((entry) => {
      const key = String(entry.internalName || entry.url || entry.name || "")
        .trim()
        .toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 512);
  return { ...initial, plugins };
}

async function classifyRemoteRepository(remote, quota) {
  const url = canonicalizePluginUrl(remote?.url || remote?.url_template || remote?.urlTemplate);
  const declaredTypeValue = remote?.repoType ?? remote?.repo_type ?? remote?.type;
  const hasExplicitType = remote?.repoTypeDeclared === true || declaredTypeValue != null;
  const explicitType = normalizePluginRepositoryType(
    declaredTypeValue,
    PLUGIN_REPOSITORY_TYPES.UNKNOWN
  );
  logPluginDiagnostic("repository classification begin", {
    remote: diagnosticRepository(remote),
    canonicalUrl: diagnosticUrl(url),
    declaredType: declaredTypeValue == null ? null : String(declaredTypeValue),
    normalizedType: explicitType,
    hasExplicitType
  });
  // The extension is an unambiguous CloudStream binary marker. Even a stale
  // or malicious cloud row claiming NUVIO_JS must never make Web TV fetch it
  // as a JavaScript manifest.
  if (/\.cs3(?:$|[?#])/i.test(url)) {
    const result = { type: PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX, url };
    logPluginDiagnostic("repository classified", {
      stage: "cs3-extension",
      input: diagnosticRepository(remote),
      result: { type: result.type, url: diagnosticUrl(result.url) }
    });
    return result;
  }
  // Android treats an empty/unknown repository enum as an absent hint and
  // still inspects the document. Keep the raw value for diagnostics, but do
  // not let it bypass the same auto-detection path on Smart TV.
  if (explicitType !== PLUGIN_REPOSITORY_TYPES.UNKNOWN) {
    if (
      [PLUGIN_REPOSITORY_TYPES.NUVIO_JS, PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX].includes(
        explicitType
      )
    ) {
      try {
        const loaded = await fetchRepositoryDocument(url, quota);
        const preferExternal =
          explicitType === PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX ||
          isExplicitExternalJsonEndpoint(url);
        const manifest = normalizePluginManifest(loaded.document, loaded.sourceUrl);
        const metadata = await loadExternalMetadata(loaded.document, loaded.sourceUrl, quota);
        if (preferExternal && metadata) {
          const result = {
            type: PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX,
            url,
            document: loaded.document,
            metadata
          };
          logPluginDiagnostic("repository classified", {
            stage: "typed-document-external",
            input: diagnosticRepository(remote),
            result: {
              type: result.type,
              url: diagnosticUrl(result.url),
              sourceUrl: diagnosticUrl(loaded.sourceUrl)
            }
          });
          return result;
        }
        if (manifest && Array.isArray(loaded.document?.scrapers)) {
          const result = {
            type: PLUGIN_REPOSITORY_TYPES.NUVIO_JS,
            url: loaded.sourceUrl,
            document: loaded.document,
            manifest
          };
          logPluginDiagnostic("repository classified", {
            stage: "typed-document-js",
            input: diagnosticRepository(remote),
            result: {
              type: result.type,
              url: diagnosticUrl(result.url),
              sourceUrl: diagnosticUrl(loaded.sourceUrl)
            }
          });
          return result;
        }
        if (metadata) {
          const result = {
            type: PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX,
            url,
            document: loaded.document,
            metadata
          };
          logPluginDiagnostic("repository classified", {
            stage: "typed-document-metadata",
            input: diagnosticRepository(remote),
            result: {
              type: result.type,
              url: diagnosticUrl(result.url),
              sourceUrl: diagnosticUrl(loaded.sourceUrl)
            }
          });
          return result;
        }
      } catch (error) {
        logPluginDiagnostic("typed repository classification failed", {
          input: diagnosticRepository(remote),
          error: diagnosticError(error)
        });
      }
    }
    if (
      explicitType !== PLUGIN_REPOSITORY_TYPES.NUVIO_JS &&
      explicitType !== PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX
    ) {
      const result = { type: explicitType, url };
      logPluginDiagnostic("repository classified", {
        stage: "explicit-non-executable-type",
        input: diagnosticRepository(remote),
        result: { type: result.type, url: diagnosticUrl(result.url) }
      });
      return result;
    }
  }
  try {
    const loaded = await fetchRepositoryDocument(url, quota);
    const preferExternal = isExplicitExternalJsonEndpoint(url);
    const manifest = normalizePluginManifest(loaded.document, loaded.sourceUrl);
    const external = await loadExternalMetadata(loaded.document, loaded.sourceUrl, quota);
    if (preferExternal && external) {
      const result = {
        type: PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX,
        url,
        document: loaded.document,
        metadata: external
      };
      logPluginDiagnostic("repository classified", {
        stage: "auto-document-external",
        input: diagnosticRepository(remote),
        result: {
          type: result.type,
          url: diagnosticUrl(result.url),
          sourceUrl: diagnosticUrl(loaded.sourceUrl)
        }
      });
      return result;
    }
    if (manifest && Array.isArray(loaded.document?.scrapers)) {
      const result = {
        type: PLUGIN_REPOSITORY_TYPES.NUVIO_JS,
        url: loaded.sourceUrl,
        document: loaded.document,
        manifest
      };
      logPluginDiagnostic("repository classified", {
        stage: "auto-document-js",
        input: diagnosticRepository(remote),
        result: {
          type: result.type,
          url: diagnosticUrl(result.url),
          sourceUrl: diagnosticUrl(loaded.sourceUrl)
        }
      });
      return result;
    }
    if (external) {
      const result = {
        type: PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX,
        url,
        document: loaded.document,
        metadata: external
      };
      logPluginDiagnostic("repository classified", {
        stage: "auto-document-metadata",
        input: diagnosticRepository(remote),
        result: {
          type: result.type,
          url: diagnosticUrl(result.url),
          sourceUrl: diagnosticUrl(loaded.sourceUrl)
        }
      });
      return result;
    }
  } catch (error) {
    logPluginDiagnostic("repository auto-classification failed", {
      input: diagnosticRepository(remote),
      error: diagnosticError(error)
    });
  }
  const result = { type: PLUGIN_REPOSITORY_TYPES.UNKNOWN, url };
  logPluginDiagnostic("repository classified", {
    stage: "unknown",
    input: diagnosticRepository(remote),
    result: { type: result.type, url: diagnosticUrl(result.url) }
  });
  return result;
}

async function downloadCode(scraper, repository, quota, profileId = null) {
  const targetProfileId = getEffectivePluginProfileId(profileId == null ? undefined : profileId);
  const profileVersion = ProfileManager.getProfileDataVersion(targetProfileId);
  const existing = await PluginCodeStore.get(scraper.id, profileId);
  logPluginDiagnostic("plugin code download begin", {
    profileId: profileId == null ? "" : String(profileId),
    repository: diagnosticRepository(repository),
    scraperId: String(scraper?.id || "").slice(0, 128),
    scraperName: String(scraper?.name || "").slice(0, 120),
    codeUrl: diagnosticUrl(scraper?.codeUrl),
    cachedCode: Boolean(existing?.code)
  });
  try {
    const response = await PluginServiceClient.fetch({
      url: scraper.codeUrl,
      method: "GET",
      headers: {
        Accept: "application/javascript, text/javascript, */*",
        "User-Agent": ANDROID_PLUGIN_MANAGEMENT_USER_AGENT
      },
      timeoutMs: quota.providerTimeoutMs,
      maxBodyBytes: quota.maxCodeBytes
    });
    if (!response.ok || response.truncated || !response.body.trim())
      throw new Error(`HTTP ${response.status || 0}`);
    if (profileVersion !== ProfileManager.getProfileDataVersion(targetProfileId)) return false;
    if (
      !(await PluginCodeStore.save(
        scraper.id,
        response.body,
        { url: scraper.codeUrl, version: scraper.version },
        { maxBytes: quota.maxCacheBytes, profile: profileId }
      ))
    ) {
      throw new Error("Plugin code cache quota exceeded");
    }
    logPluginDiagnostic("plugin code download success", {
      profileId: profileId == null ? "" : String(profileId),
      repositoryId: String(repository?.id || "").slice(0, 128),
      scraperId: String(scraper?.id || "").slice(0, 128),
      httpStatus: response.status,
      bodyBytes: response.body.length,
      cachedCode: true
    });
    return true;
  } catch (error) {
    logPluginDiagnostic("plugin code download failed", {
      profileId: profileId == null ? "" : String(profileId),
      repositoryId: String(repository?.id || "").slice(0, 128),
      scraperId: String(scraper?.id || "").slice(0, 128),
      codeUrl: diagnosticUrl(scraper?.codeUrl),
      cachedCode: Boolean(existing?.code),
      error: diagnosticError(error)
    });
    return Boolean(existing?.code);
  }
}

async function hydrateJsRepository(
  state,
  repository,
  manifest,
  { markDirty = false, profileId = null } = {}
) {
  const quota = quotaFor();
  const previousIds = state.scrapers
    .filter((entry) => entry.repositoryId === repository.id)
    .map((entry) => entry.id);
  logPluginDiagnostic("JS repository hydration begin", {
    profileId: profileId == null ? "" : String(profileId),
    repository: diagnosticRepository(repository),
    manifestScraperCount: Array.isArray(manifest?.scrapers) ? manifest.scrapers.length : 0,
    previousScraperCount: previousIds.length,
    markDirty
  });
  let next = await mergeRepositoryScrapers(state, repository, manifest, profileId);
  const nextIds = new Set(
    next.scrapers.filter((entry) => entry.repositoryId === repository.id).map((entry) => entry.id)
  );
  await Promise.all(
    previousIds.filter((id) => !nextIds.has(id)).map((id) => PluginCodeStore.remove(id, profileId))
  );
  const hydrated = [];
  const repositoryScrapers = next.scrapers.filter((entry) => entry.repositoryId === repository.id);
  logPluginDiagnostic("JS repository code hydration begin", {
    profileId: profileId == null ? "" : String(profileId),
    repository: diagnosticRepository(repository),
    scraperCount: repositoryScrapers.length,
    removedCachedScraperCount: previousIds.filter(
      (id) => !repositoryScrapers.some((entry) => entry.id === id)
    ).length
  });
  for (const scraper of repositoryScrapers) {
    const codeAvailable = await downloadCode(scraper, repository, quota, profileId);
    hydrated.push({ ...scraper, codeAvailable });
  }
  next = {
    ...next,
    scrapers: [
      ...next.scrapers.filter((entry) => entry.repositoryId !== repository.id),
      ...hydrated
    ],
    syncDirty: markDirty || next.syncDirty
  };
  const normalized = normalizePluginState(next);
  logPluginDiagnostic("JS repository hydration complete", {
    profileId: profileId == null ? "" : String(profileId),
    repository: diagnosticRepository(repository),
    scraperCount: hydrated.length,
    codeAvailableCount: hydrated.filter((entry) => entry.codeAvailable).length,
    codeMissingCount: hydrated.filter((entry) => !entry.codeAvailable).length,
    ...diagnosticState(normalized)
  });
  return normalized;
}

function externalScrapers(repository, metadata) {
  const entries = Array.isArray(metadata?.plugins) ? metadata.plugins : [];
  return entries.map((entry, index) => {
    const identity = String(
      entry.internalName ||
        entry.url ||
        entry.name ||
        entry.id ||
        stablePluginHash(JSON.stringify(entry))
    );
    return {
      id: scraperIdForManifest(repository.id, identity, entry.url || entry.name || "external"),
      manifestId: identity,
      name: String(entry.name || entry.internalName || `CloudStream extension ${index + 1}`),
      description: String(entry.description || ""),
      version: String(entry.version || entry.apiVersion || "1"),
      filename: String(entry.url || ""),
      sourceUrl: resolvePluginUrl(entry.url, repository.url),
      supportedTypes: Array.isArray(entry.tvTypes) ? entry.tvTypes : [],
      contentLanguage: Array.isArray(entry.language)
        ? entry.language
        : Array.isArray(entry.languages)
          ? entry.languages
          : [],
      formats: Array.isArray(entry.formats) ? entry.formats : [],
      author: String(entry.author || ""),
      // Android registers external entries as visible/enabled rows, while the
      // repository-wide execution gate still excludes EXTERNAL_DEX on Web TV.
      // Preserve the remote status without ever downloading the binary.
      enabled: true,
      manifestEnabled: entry.status === undefined ? true : Number(entry.status) === 1,
      codeAvailable: false,
      type: PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX,
      repositoryId: repository.id,
      logo: resolvePluginUrl(entry.iconUrl, repository.url) || null,
      externalMetadata: entry
    };
  });
}

async function clearRepositoryExecution(state, repositoryId, profileId = null) {
  await Promise.all(
    state.scrapers
      .filter((entry) => entry.repositoryId === repositoryId)
      .map((entry) => PluginCodeStore.remove(entry.id, profileId))
  );
  return {
    ...state,
    scrapers: state.scrapers.filter((entry) => entry.repositoryId !== repositoryId)
  };
}

async function replaceRepositoryAsNonExecutable(
  state,
  existing,
  remote,
  detected,
  metadata = null,
  profileId = null
) {
  const cleaned = await clearRepositoryExecution(state, existing.id, profileId);
  const type =
    detected.type === PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX
      ? PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX
      : PLUGIN_REPOSITORY_TYPES.LEGACY;
  const repository = {
    ...existing,
    url: detected.url || existing.url,
    name: String(
      metadata?.name ||
        remote.name ||
        existing.name ||
        (type === PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX
          ? "CloudStream repository"
          : "Legacy repository")
    ),
    description: String(metadata?.description || remote.description || existing.description || ""),
    type,
    metadata,
    scraperCount: 0,
    lastUpdated: metadata ? Date.now() : existing.lastUpdated
  };
  const scrapers = metadata ? externalScrapers(repository, metadata) : [];
  return {
    ...cleaned,
    repositories: cleaned.repositories.map((entry) =>
      entry.id === existing.id ? { ...repository, scraperCount: scrapers.length } : entry
    ),
    scrapers: [...cleaned.scrapers, ...scrapers]
  };
}

async function hydrateDetectedJsRepository(state, existing, remote, detected, profileId = null) {
  const quota = quotaFor();
  const manifestUrl = canonicalizePluginUrl(detected.url || remote.url, { manifest: true });
  const manifest =
    detected.manifest || normalizePluginManifest(await fetchJson(manifestUrl, quota), manifestUrl);
  if (!manifest) throw new Error("JS repository manifest is invalid");
  const cleaned = await clearRepositoryExecution(state, existing.id, profileId);
  return hydrateJsRepository(
    cleaned,
    {
      ...existing,
      url: manifestUrl,
      name: manifest.name,
      description: manifest.description,
      type: PLUGIN_REPOSITORY_TYPES.NUVIO_JS
    },
    manifest,
    { profileId }
  );
}

function createRemoteStub(remote = {}) {
  const url = canonicalizePluginUrl(remote.url || remote.url_template || remote.urlTemplate);
  const declaredType = normalizePluginRepositoryType(
    remote.repoType || remote.repo_type || remote.type,
    PLUGIN_REPOSITORY_TYPES.UNKNOWN
  );
  const type = /\.cs3(?:$|[?#])/i.test(url) ? PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX : declaredType;
  // Android assigns a random UUID to each newly discovered local repository.
  // The URL remains the duplicate/reconciliation key; it is not the local id.
  const id = randomPluginUuid();
  return {
    id,
    name: String(
      remote.name ||
        (type === PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX
          ? "CloudStream repository"
          : "Unsupported repository")
    ),
    url,
    description: String(remote.description || ""),
    // Android creates a newly discovered repository enabled regardless of the
    // cloud row's historical enabled flag; that field is sent on push but is
    // not applied by its pull/reconcile path.
    enabled: true,
    type,
    lastUpdated: 0,
    scraperCount: 0,
    metadata: remote.raw || remote
  };
}

async function runWithPool(task, quota, signal) {
  if (signal?.aborted) return [];
  if (runningExecutions >= quota.maxConcurrent) {
    // Match Android's semaphore behavior: limit active workers without dropping
    // eligible providers when a source request starts a large scraper batch.
    return new Promise((resolve) => {
      const queued = {
        task,
        quota,
        resolve,
        signal,
        onAbort: null
      };
      const cancel = () => {
        const index = queuedExecutions.indexOf(queued);
        if (index < 0) return;
        queuedExecutions.splice(index, 1);
        signal?.removeEventListener?.("abort", queued.onAbort);
        resolve([]);
      };
      queued.onAbort = cancel;
      queuedExecutions.push(queued);
      signal?.addEventListener?.("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
    });
  }
  runningExecutions += 1;
  try {
    return await task();
  } finally {
    runningExecutions = Math.max(0, runningExecutions - 1);
    const next = queuedExecutions.shift();
    if (next) {
      next.signal?.removeEventListener?.("abort", next.onAbort);
      if (next.signal?.aborted) {
        next.resolve([]);
      } else {
        runWithPool(next.task, next.quota, next.signal)
          .then(next.resolve)
          .catch(() => next.resolve([]));
      }
    }
  }
}

async function executeOne(
  scraper,
  repository,
  args,
  quota,
  signal,
  { throwOnError = false, mapResults = true } = {}
) {
  const executionProfileId = getEffectivePluginProfileId();
  let code = await PluginCodeStore.get(scraper.id, executionProfileId);
  if (!code?.code && scraper.codeUrl) {
    await downloadCode(scraper, repository, quota, executionProfileId);
    code = await PluginCodeStore.get(scraper.id, executionProfileId);
  }
  if (!code?.code) return [];
  const executionSettings =
    currentState(executionProfileId).settings.scraperSettings?.[scraper.id] || {};
  const key = `${executionProfileId}:${repository.id}:${scraper.id}:${args.tmdbId}:${args.mediaType}:${args.season}:${args.episode}`;
  const promise = singleFlight
    .run(
      key,
      (executionSignal) =>
        runWithPool(
          () =>
            PluginRuntime.executePlugin({
              code: code.code,
              filename: scraper.filename || `${scraper.id}.js`,
              scraperId: scraper.id,
              profileId: executionProfileId,
              repositoryId: repository.id,
              settings: executionSettings,
              args,
              quota,
              timeoutMs: quota.providerTimeoutMs,
              signal: executionSignal
            }),
          quota,
          executionSignal
        ),
      { signal, abortedValue: [] }
    )
    .then((results) => {
      const rawResults = (Array.isArray(results) ? results : []).slice(
        0,
        quota.maxResultsPerScraper
      );
      if (!mapResults) return rawResults;
      return rawResults.map((entry) => resultToStream(entry, scraper)).filter(Boolean);
    })
    .catch((error) => {
      logPluginDiagnostic("plugin scraper execution failed", {
        repository: diagnosticRepository(repository),
        scraperId: String(scraper?.id || "").slice(0, 128),
        scraperName: String(scraper?.name || "").slice(0, 120),
        error: diagnosticError(error)
      });
      if (throwOnError) throw error;
      return [];
    });
  return promise;
}

export const PluginManager = {
  get pluginsEnabled() {
    return currentState().settings.pluginsEnabled !== false;
  },

  get groupStreamsByRepository() {
    return currentState().settings.groupStreamsByRepository === true;
  },

  getEffectiveProfileId() {
    return getEffectivePluginProfileId();
  },

  getCapabilitySnapshot() {
    const capabilities = getPluginCapabilitySnapshot();
    const runtime = currentState().runtime;
    const executable = capabilities.candidate && runtime.lastStatus === "ready";
    return {
      ...capabilities,
      executable,
      pluginServiceAvailable: runtime.lastStatus === "ready",
      localJsPluginSupported: executable,
      pluginMemoryBudget: Number(capabilities.quota?.memoryLimitBytes || 0),
      pluginMaxConcurrency: Number(capabilities.quota?.maxConcurrent || 0),
      runtimeHandshakeComplete: runtime.lastStatus === "ready",
      runtimeStatus: runtime.lastStatus,
      runtimeError: runtime.lastError
    };
  },

  getSearchTimeoutMs(mediaType) {
    const quota = quotaFor(getPluginCapabilitySnapshot());
    const state = currentState();
    const eligibleCount = executableScrapersForMediaType(state, mediaType).length;
    const maxConcurrent = Math.max(1, Number(quota.maxConcurrent) || 1);
    const providerTimeoutMs = Math.max(0, Number(quota.providerTimeoutMs) || 0);
    const queuedCount = runningExecutions + queuedExecutions.length;
    const totalProviderCount = eligibleCount + queuedCount;
    const waves = Math.ceil(totalProviderCount / maxConcurrent);
    const staggerTimeoutMs = Math.max(0, eligibleCount - 1) * 60;
    const setupTimeoutMs = totalProviderCount > 0 ? providerTimeoutMs : 0;
    const batchTimeoutMs = setupTimeoutMs + waves * providerTimeoutMs + staggerTimeoutMs;

    // Android drains every enabled provider in concurrency-limited waves.
    // Reserve one provider window for TV setup and lazy code retrieval, then
    // budget each wave while keeping the existing floor for smaller searches.
    return Math.max(Number(quota.globalTimeoutMs) || 0, batchTimeoutMs);
  },

  getRuntimeStatus({ probe = false } = {}) {
    if (!probe) return Promise.resolve(this.getCapabilitySnapshot());
    return this.ensureRuntime()
      .then(() => this.getCapabilitySnapshot())
      .catch(() => this.getCapabilitySnapshot());
  },

  async ensureRuntime() {
    const capabilities = getPluginCapabilitySnapshot();
    logPluginDiagnostic("runtime ensure begin", {
      platform: capabilities.platform,
      candidate: capabilities.candidate,
      executable: capabilities.executable,
      reason: capabilities.reason,
      pluginServicePackaged: capabilities.pluginServicePackaged,
      tizenVersion: capabilities.tizenVersion || "",
      chromiumMajorVersion: capabilities.chromiumMajorVersion || 0
    });
    if (!capabilities.candidate) {
      markRuntime("unsupported", capabilities.reason);
      logPluginDiagnostic("runtime ensure skipped", { reason: capabilities.reason });
      throw new Error(capabilities.reason);
    }
    if (!runtimeReadyPromise) {
      const quota = quotaFor(capabilities);
      runtimeReadyPromise = Promise.all([
        PluginServiceClient.ensureReady(),
        PluginRuntime.selfTest({ quota })
      ])
        .then(() => {
          markRuntime("ready", "");
          logPluginDiagnostic("runtime ensure success", {
            platform: capabilities.platform,
            memoryBudget: quota.memoryLimitBytes,
            maxConcurrent: quota.maxConcurrent
          });
          return true;
        })
        .catch((error) => {
          runtimeReadyPromise = null;
          markRuntime("error", error?.message || error);
          logPluginDiagnostic("runtime ensure failed", { error: diagnosticError(error) });
          throw error;
        });
    }
    return runtimeReadyPromise;
  },

  listRepositories() {
    return currentState().repositories;
  },

  listScrapers(repositoryId = null) {
    const scrapers = currentState().scrapers;
    return repositoryId
      ? scrapers.filter((entry) => entry.repositoryId === repositoryId)
      : scrapers;
  },

  hasCompatibleScrapers(mediaType) {
    if (!this.pluginsEnabled) return false;
    const state = currentState();
    return state.scrapers.some((scraper) => {
      const repository = state.repositories.find((entry) => entry.id === scraper.repositoryId);
      return (
        isExecutableScraper(scraper, repository, platformId()) &&
        scraper.codeAvailable !== false &&
        pluginSupportsType(scraper.supportedTypes, mediaType)
      );
    });
  },

  listPluginSources() {
    return currentState().legacySources;
  },

  getSummary() {
    const state = currentState();
    return {
      repositories: state.repositories,
      scrapers: state.scrapers,
      legacySources: state.legacySources,
      unknownRemoteRows: state.unknownRemoteRows,
      pluginsEnabled: state.settings.pluginsEnabled !== false,
      groupStreamsByRepository: state.settings.groupStreamsByRepository === true,
      runtime: this.getCapabilitySnapshot(),
      readOnly: !canEdit(),
      effectiveProfileId: getEffectivePluginProfileId()
    };
  },

  setPluginsEnabled(enabled) {
    if (!canEdit()) return false;
    const state = currentState();
    PluginStore.replace({
      ...state,
      settings: { ...state.settings, pluginsEnabled: Boolean(enabled) },
      // Android keeps this setting local; it is not part of the remote
      // `plugins` repository payload. Preserve a repository mutation that may
      // already be waiting to be pushed.
      syncDirty: state.syncDirty
    });
    return true;
  },

  setGroupStreamsByRepository(enabled) {
    if (!canEdit()) return false;
    const state = currentState();
    PluginStore.replace({
      ...state,
      settings: { ...state.settings, groupStreamsByRepository: Boolean(enabled) },
      // Android keeps this setting local; it is not part of the remote
      // `plugins` repository payload. Preserve a repository mutation that may
      // already be waiting to be pushed.
      syncDirty: state.syncDirty
    });
    return true;
  },

  async addRepository(input) {
    if (!canEdit()) throw new Error("Plugin settings are read-only for this profile");
    // Repository loading is asynchronous. Keep the operation bound to the
    // effective profile that authorized it so a profile switch while the
    // manifest/code is downloading cannot write the result into the new
    // active profile.
    const targetProfileId = getEffectivePluginProfileId();
    const rawInput = String(input || "").trim();
    const rawUrl = isPluginShortCode(rawInput)
      ? await resolvePluginShortCode(rawInput)
      : sanitizePluginRepositoryInput(rawInput);
    if (isPluginShortCode(rawInput) && !rawUrl) {
      throw new Error(`Failed to resolve short code: ${rawInput}`);
    }
    if (!rawUrl) throw new Error("Repository URL is empty");
    if (/\.cs3(?:$|[?#])/i.test(rawUrl)) {
      const urlValidation = validatePluginUrl(rawUrl);
      if (!urlValidation.ok) throw new Error(urlValidation.reason);
      const repository = createRemoteStub({
        url: canonicalizePluginUrl(rawUrl),
        repoType: PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX,
        name: rawUrl.split("/").pop() || "CloudStream extension"
      });
      const state = currentState(targetProfileId);
      const repositoryKey = repositoryIdentity(repository.url);
      if (!state.repositories.some((entry) => repositoryIdentity(entry.url) === repositoryKey)) {
        PluginStore.replace(
          {
            ...state,
            repositories: [...state.repositories, repository],
            syncDirty: true
          },
          targetProfileId
        );
      }
      return repository;
    }
    const normalizedUrl = canonicalizePluginUrl(rawUrl);
    const validation = validatePluginUrl(normalizedUrl);
    if (!validation.ok) throw new Error(validation.reason);
    const initialState = currentState(targetProfileId);
    const identity = repositoryIdentity(normalizedUrl);
    const existing = initialState.repositories.find(
      (entry) => identity && repositoryIdentity(entry.url) === identity
    );
    if (existing) return existing;
    const quota = quotaFor();
    // Repository metadata/code may be synchronized and cached even when this
    // TV cannot execute QuickJS. The capability gate belongs to execution,
    // not to preserving the user's repository intent.
    const loaded = await fetchRepositoryDocument(normalizedUrl, quota);
    const document = loaded.document;
    const sourceUrl = loaded.sourceUrl;
    const manifest = normalizePluginManifest(document, sourceUrl);
    const external = await loadExternalMetadata(document, sourceUrl, quota);
    // Re-read after the network work. A pull or another UI action may have
    // changed the repository list while the document was loading; never let
    // this add operation replace that newer state with its old snapshot.
    const state = currentState(targetProfileId);
    const sourceIdentity = repositoryIdentity(sourceUrl);
    const existingAfterLoad = state.repositories.find(
      (entry) =>
        (identity && repositoryIdentity(entry.url) === identity) ||
        (sourceIdentity && repositoryIdentity(entry.url) === sourceIdentity)
    );
    if (existingAfterLoad) return existingAfterLoad;
    const saveExternalRepository = () => {
      const repository = createRemoteStub({
        url: canonicalizePluginUrl(rawUrl),
        repoType: PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX,
        name: external.name,
        description: external.description
      });
      const scrapers = externalScrapers(repository, external);
      const next = {
        ...state,
        repositories: [
          ...state.repositories.filter((entry) => entry.id !== repository.id),
          {
            ...repository,
            metadata: external,
            scraperCount: scrapers.length,
            lastUpdated: Date.now()
          }
        ],
        scrapers: [
          ...state.scrapers.filter((entry) => entry.repositoryId !== repository.id),
          ...scrapers
        ],
        syncDirty: true
      };
      PluginStore.replace(next, targetProfileId);
      return repository;
    };
    // Android tries a specific external .json feed before treating it as a
    // Nuvio manifest. Keep that precedence for mixed/ambiguous documents.
    if (external && isExplicitExternalJsonEndpoint(normalizedUrl)) {
      return saveExternalRepository();
    }
    if (manifest && Array.isArray(document.scrapers)) {
      const repository = {
        ...(state.repositories.find((entry) => entry.url === canonicalizePluginUrl(sourceUrl)) ||
          {}),
        id: randomPluginUuid(),
        name: manifest.name,
        url: canonicalizePluginUrl(sourceUrl),
        description: manifest.description,
        enabled:
          state.repositories.find((entry) => entry.url === canonicalizePluginUrl(sourceUrl))
            ?.enabled !== false,
        type: PLUGIN_REPOSITORY_TYPES.NUVIO_JS
      };
      const hydrationRevision = PluginStore.getRevision(targetProfileId);
      const next = await hydrateJsRepository(state, repository, manifest, {
        markDirty: true,
        profileId: targetProfileId
      });
      const currentAfterHydration = currentState(targetProfileId);
      if (PluginStore.getRevision(targetProfileId) !== hydrationRevision) {
        const concurrentRepository = currentAfterHydration.repositories.find(
          (entry) => repositoryIdentity(entry.url) === repositoryIdentity(repository.url)
        );
        if (concurrentRepository) return concurrentRepository;
        const hydratedScrapers = next.scrapers.filter(
          (entry) => entry.repositoryId === repository.id
        );
        const merged = {
          ...currentAfterHydration,
          repositories: [
            ...currentAfterHydration.repositories.filter((entry) => entry.id !== repository.id),
            next.repositories.find((entry) => entry.id === repository.id) || repository
          ],
          scrapers: [
            ...currentAfterHydration.scrapers.filter(
              (entry) => entry.repositoryId !== repository.id
            ),
            ...hydratedScrapers
          ],
          syncDirty: true
        };
        PluginStore.replace(merged, targetProfileId);
        return merged.repositories.find((entry) => entry.id === repository.id);
      }
      PluginStore.replace(next, targetProfileId);
      return repository;
    }
    if (external) return saveExternalRepository();
    throw new Error("Repository format is not supported");
  },

  async refreshRepository(repositoryId) {
    if (!canEdit()) throw new Error("Plugin settings are read-only for this profile");
    const targetProfileId = getEffectivePluginProfileId();
    const state = currentState(targetProfileId);
    const repository = state.repositories.find((entry) => entry.id === repositoryId);
    if (!repository) throw new Error("Repository not found");
    const refreshRevision = PluginStore.getRevision(targetProfileId);
    if (!isExecutablePluginRepository(repository)) {
      if (
        repository.type === PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX &&
        !/\.cs3(?:$|[?#])/i.test(repository.url)
      ) {
        const loaded = await fetchRepositoryDocument(repository.url, quotaFor());
        const external = await loadExternalMetadata(loaded.document, loaded.sourceUrl, quotaFor());
        if (!external) throw new Error("CloudStream repository metadata is invalid");
        const scrapers = externalScrapers(repository, external);
        const refreshedState = {
          ...state,
          repositories: state.repositories.map((entry) =>
            entry.id === repository.id
              ? {
                  ...entry,
                  name: external.name,
                  description: external.description,
                  metadata: external,
                  scraperCount: scrapers.length,
                  lastUpdated: Date.now()
                }
              : entry
          ),
          scrapers: [
            ...state.scrapers.filter((entry) => entry.repositoryId !== repository.id),
            ...scrapers
          ],
          // Refresh updates local metadata/provider cache only. Android does
          // not enqueue a repository push for this operation.
          syncDirty: state.syncDirty
        };
        const currentAfterRefresh = currentState(targetProfileId);
        if (PluginStore.getRevision(targetProfileId) !== refreshRevision) {
          if (!currentAfterRefresh.repositories.some((entry) => entry.id === repository.id)) {
            return { ok: false, reason: "Repository was removed during refresh" };
          }
          if (
            currentAfterRefresh.syncDirty ||
            cloudRepositoryFingerprint(currentAfterRefresh) !== cloudRepositoryFingerprint(state)
          ) {
            return { ok: true, preservedLocalChanges: true, metadataOnly: true };
          }
          PluginStore.replace(
            mergeLocalOnlyChanges(state, refreshedState, currentAfterRefresh),
            targetProfileId
          );
        } else {
          PluginStore.replace(refreshedState, targetProfileId);
        }
        return { ok: true, metadataOnly: true };
      }
      return { ok: false, reason: "CloudStream/DEX repositories are metadata-only on Web TV" };
    }
    const manifestUrl = canonicalizePluginUrl(repository.url, { manifest: true });
    const manifest = normalizePluginManifest(await fetchJson(manifestUrl, quotaFor()), manifestUrl);
    if (!manifest) throw new Error("JS repository manifest is invalid");
    const next = await hydrateJsRepository(
      state,
      { ...repository, url: manifestUrl, name: manifest.name },
      manifest,
      // Refresh updates local metadata/provider cache only. Android does not
      // enqueue a repository push for this operation.
      { markDirty: false, profileId: targetProfileId }
    );
    const currentAfterRefresh = currentState(targetProfileId);
    if (PluginStore.getRevision(targetProfileId) !== refreshRevision) {
      if (!currentAfterRefresh.repositories.some((entry) => entry.id === repository.id)) {
        return { ok: false, reason: "Repository was removed during refresh" };
      }
      if (
        currentAfterRefresh.syncDirty ||
        cloudRepositoryFingerprint(currentAfterRefresh) !== cloudRepositoryFingerprint(state)
      ) {
        return { ok: true, preservedLocalChanges: true };
      }
      PluginStore.replace(mergeLocalOnlyChanges(state, next, currentAfterRefresh), targetProfileId);
    } else {
      PluginStore.replace(next, targetProfileId);
    }
    return { ok: true };
  },

  async removeRepository(repositoryId) {
    if (!canEdit()) return false;
    const targetProfileId = getEffectivePluginProfileId();
    const state = currentState(targetProfileId);
    const repository = state.repositories.find((entry) => entry.id === repositoryId);
    if (!repository || repository.type === PLUGIN_REPOSITORY_TYPES.UNKNOWN) return false;
    const removedCacheIds = new Set();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = currentState(targetProfileId);
      if (!current.repositories.some((entry) => entry.id === repositoryId)) return true;
      const scraperIds = current.scrapers
        .filter((entry) => entry.repositoryId === repositoryId)
        .map((entry) => entry.id)
        .filter((id) => !removedCacheIds.has(id));
      if (!scraperIds.length) break;
      await Promise.all(
        scraperIds.map(async (id) => {
          await PluginCodeStore.remove(id, targetProfileId);
          removedCacheIds.add(id);
        })
      );
    }
    const latestState = currentState(targetProfileId);
    if (!latestState.repositories.some((entry) => entry.id === repositoryId)) return true;
    PluginStore.replace(
      {
        ...latestState,
        repositories: latestState.repositories.filter((entry) => entry.id !== repositoryId),
        scrapers: latestState.scrapers.filter((entry) => entry.repositoryId !== repositoryId),
        syncDirty: true
      },
      targetProfileId
    );
    // Android permits removing DEX repositories and pushes user-initiated
    // removals immediately so a subsequent pull cannot re-add them before the
    // debounced add/update sync runs.
    await PluginStore.flushCloudSync(targetProfileId);
    return true;
  },

  setRepositoryEnabled(repositoryId, enabled) {
    if (!canEdit()) return false;
    const state = currentState();
    const repository = state.repositories.find((entry) => entry.id === repositoryId);
    if (!repository) return false;
    PluginStore.replace({
      ...state,
      repositories: state.repositories.map((entry) =>
        entry.id === repositoryId ? { ...entry, enabled: Boolean(enabled) } : entry
      ),
      syncDirty: true
    });
    return true;
  },

  setScraperEnabled(scraperId, enabled) {
    if (!canEdit()) return false;
    const state = currentState();
    const scraper = state.scrapers.find((entry) => entry.id === scraperId);
    const repository = state.repositories.find((entry) => entry.id === scraper?.repositoryId);
    if (
      !scraper ||
      !repository ||
      isExternalDexRepository(repository) ||
      repository?.type !== PLUGIN_REPOSITORY_TYPES.NUVIO_JS ||
      scraper.type !== PLUGIN_REPOSITORY_TYPES.NUVIO_JS
    )
      return false;
    PluginStore.replace({
      ...state,
      scrapers: state.scrapers.map((entry) =>
        entry.id === scraperId ? { ...entry, enabled: Boolean(enabled) } : entry
      ),
      // Scraper enablement is local-only on Android and has no remote row.
      syncDirty: state.syncDirty
    });
    return true;
  },

  setAllScrapersEnabled(repositoryId, enabled) {
    if (!canEdit()) return false;
    const state = currentState();
    const repository = state.repositories.find((entry) => entry.id === repositoryId);
    if (
      !repository ||
      isExternalDexRepository(repository) ||
      repository.type !== PLUGIN_REPOSITORY_TYPES.NUVIO_JS
    )
      return false;
    PluginStore.replace({
      ...state,
      scrapers: state.scrapers.map((entry) =>
        entry.repositoryId === repositoryId && entry.type === PLUGIN_REPOSITORY_TYPES.NUVIO_JS
          ? { ...entry, enabled: Boolean(enabled) }
          : entry
      ),
      // Scraper enablement is local-only on Android and has no remote row.
      syncDirty: state.syncDirty
    });
    return true;
  },

  async reconcileWithRemoteRepoUrls(
    remotePlugins = [],
    {
      removeMissingLocal = true,
      authoritativeSnapshot = false,
      allowVerifiedEmptySnapshot = false,
      expectedRevision = null,
      profileId = null
    } = {}
  ) {
    return withReconcileLock(async () => {
      const targetProfileId = getEffectivePluginProfileId(
        profileId == null ? undefined : profileId
      );
      const incoming = (Array.isArray(remotePlugins) ? remotePlugins : [])
        .map((entry) => (typeof entry === "string" ? { url: entry } : entry || {}))
        .map((entry) => ({
          ...entry,
          url: canonicalizePluginUrl(entry.url || entry.url_template || entry.urlTemplate)
        }))
        .filter((entry) => entry.url)
        .filter(
          (entry, index, values) =>
            values.findIndex(
              (candidate) => repositoryIdentity(candidate.url) === repositoryIdentity(entry.url)
            ) === index
        );
      const state = currentState(targetProfileId);
      let reconciliationRevision = PluginStore.getRevision(targetProfileId);
      logPluginDiagnostic("reconcile begin", {
        targetProfileId: String(targetProfileId),
        removeMissingLocal,
        authoritativeSnapshot,
        allowVerifiedEmptySnapshot,
        expectedRevision,
        reconciliationRevision,
        incomingCount: incoming.length,
        incoming: incoming.slice(0, 64).map(diagnosticRepository),
        ...diagnosticState(state)
      });
      const reconcileRevisionChanges = () => {
        const current = currentState(targetProfileId);
        const currentRevision = PluginStore.getRevision(targetProfileId);
        if (currentRevision === reconciliationRevision) return true;
        if (
          current.syncDirty ||
          cloudRepositoryFingerprint(current) !== cloudRepositoryFingerprint(state)
        ) {
          next = current;
          return false;
        }
        next = mergeLocalOnlyChanges(state, next, current);
        reconciliationRevision = currentRevision;
        return true;
      };
      if (expectedRevision != null && reconciliationRevision !== Number(expectedRevision)) {
        logPluginDiagnostic("reconcile skipped", {
          targetProfileId: String(targetProfileId),
          reason: "revision mismatch",
          expectedRevision,
          reconciliationRevision
        });
        return state;
      }
      // Match Android's empty-snapshot guard: an empty successful response is
      // not evidence that the local profile should be cleared. The sync
      // service may opt in only after an independent authenticated overview
      // confirms that this existing profile has zero remote plugin rows.
      const canApplyVerifiedEmptySnapshot =
        authoritativeSnapshot && allowVerifiedEmptySnapshot === true;
      if (!incoming.length && !canApplyVerifiedEmptySnapshot) {
        logPluginDiagnostic("reconcile skipped", {
          targetProfileId: String(targetProfileId),
          reason: "empty remote snapshot",
          allowVerifiedEmptySnapshot: canApplyVerifiedEmptySnapshot
        });
        return state;
      }
      let next = { ...state };
      const unknownRemoteRows = [];
      for (const remote of incoming) {
        logPluginDiagnostic("reconcile repository begin", {
          targetProfileId: String(targetProfileId),
          remote: diagnosticRepository(remote)
        });
        const remoteIdentity = repositoryIdentity(remote.url);
        const existingByRemoteIdentity = next.repositories.find(
          (entry) => repositoryIdentity(entry.url) === remoteIdentity
        );
        // Android keeps an existing repository and its cached scrapers when an
        // old cloud row does not declare repo_type. Do the same for known local
        // repositories: a missing type is not evidence that they should be
        // classified again. A stale UNKNOWN row is different: it has no usable
        // local cache, so retry classification while reconciling the fresh
        // row. Manifest hydration is best-effort and may leave an opaque/stub
        // row until the optional runtime becomes available.
        const typeHint = remoteRepositoryTypeHint(remote);
        const shouldReclassifyUnknown =
          existingByRemoteIdentity &&
          typeHint === null &&
          existingByRemoteIdentity.type === PLUGIN_REPOSITORY_TYPES.UNKNOWN;
        const detected =
          existingByRemoteIdentity && typeHint === null && !shouldReclassifyUnknown
            ? { type: existingByRemoteIdentity.type, url: existingByRemoteIdentity.url }
            : existingByRemoteIdentity && typeHint !== null
              ? { type: typeHint, url: remote.url }
              : await classifyRemoteRepository(remote, quotaFor());
        const type = detected.type;
        logPluginDiagnostic("reconcile repository detected", {
          targetProfileId: String(targetProfileId),
          remote: diagnosticRepository(remote),
          existing: existingByRemoteIdentity
            ? diagnosticRepository(existingByRemoteIdentity)
            : null,
          typeHint,
          detectedType: type,
          detectedUrl: diagnosticUrl(detected.url),
          hasManifest: Boolean(detected.manifest),
          hasMetadata: Boolean(detected.metadata)
        });
        const detectedRemote = { ...remote, url: detected.url || remote.url, repoType: type };
        const detectedIdentity = repositoryIdentity(detectedRemote.url);
        const existing = next.repositories.find((entry) => {
          const localIdentity = repositoryIdentity(entry.url);
          return (
            localIdentity &&
            (localIdentity === remoteIdentity || localIdentity === detectedIdentity)
          );
        });
        if (existing) {
          if (type === PLUGIN_REPOSITORY_TYPES.UNKNOWN) {
            unknownRemoteRows.push(remote.raw || remote);
            logPluginDiagnostic("reconcile repository kept opaque", {
              targetProfileId: String(targetProfileId),
              reason: "unknown type for existing repository",
              repository: diagnosticRepository(existing),
              remote: diagnosticRepository(remote),
              unknownRemoteRowsCount: unknownRemoteRows.length
            });
            continue;
          }
          if (
            type === PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX ||
            type === PLUGIN_REPOSITORY_TYPES.LEGACY
          ) {
            // A typed DEX row is opaque to Web. A normal pull contains only the
            // repository row, not the Android-side binary metadata, so keeping
            // the local DEX entry byte-for-byte is safer than rebuilding it and
            // accidentally dropping its preserved scraper metadata or flag.
            if (
              type === PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX &&
              existing.type === PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX &&
              !detected.metadata
            ) {
              continue;
            }
            const external =
              type === PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX
                ? detected.metadata ||
                  normalizeExternalRepositoryMetadata(detected.document, detected.url)
                : null;
            // A typed remote transition is authoritative for execution policy:
            // remove any cached JS code before retaining the row as metadata-only.
            next = await replaceRepositoryAsNonExecutable(
              next,
              existing,
              remote,
              detected,
              external,
              targetProfileId
            );
            continue;
          }
          if (
            type === PLUGIN_REPOSITORY_TYPES.NUVIO_JS &&
            existing.type !== PLUGIN_REPOSITORY_TYPES.NUVIO_JS
          ) {
            try {
              next = await hydrateDetectedJsRepository(
                next,
                existing,
                remote,
                detected,
                targetProfileId
              );
            } catch (error) {
              logPluginDiagnostic("JS repository rehydration failed", {
                targetProfileId: String(targetProfileId),
                repository: diagnosticRepository(existing),
                remote: diagnosticRepository(remote),
                error: diagnosticError(error)
              });
            }
          }
          continue;
        }
        if (type === PLUGIN_REPOSITORY_TYPES.UNKNOWN) {
          unknownRemoteRows.push(remote.raw || remote);
          next.repositories = [...next.repositories, createRemoteStub(detectedRemote)];
          logPluginDiagnostic("reconcile repository kept opaque", {
            targetProfileId: String(targetProfileId),
            reason: "unknown type for new repository",
            remote: diagnosticRepository(remote),
            unknownRemoteRowsCount: unknownRemoteRows.length
          });
          continue;
        }
        if (type === PLUGIN_REPOSITORY_TYPES.NUVIO_JS) {
          try {
            const manifestUrl =
              detected.url || canonicalizePluginUrl(remote.url, { manifest: true });
            const manifest =
              detected.manifest ||
              normalizePluginManifest(await fetchJson(manifestUrl, quotaFor()), manifestUrl);
            if (manifest)
              next = await hydrateJsRepository(
                next,
                {
                  ...createRemoteStub({ ...remote, url: manifestUrl, repoType: type }),
                  type,
                  url: manifestUrl,
                  name: manifest.name
                },
                manifest,
                { profileId: targetProfileId }
              );
          } catch (error) {
            logPluginDiagnostic("JS repository hydration failed", {
              targetProfileId: String(targetProfileId),
              remote: diagnosticRepository(remote),
              error: diagnosticError(error)
            });
            next.repositories = [
              ...next.repositories,
              createRemoteStub({ ...remote, repoType: type })
            ];
          }
        } else {
          const stub = createRemoteStub({ ...detectedRemote, repoType: type });
          const external =
            detected.metadata ||
            normalizeExternalRepositoryMetadata(detected.document, detected.url);
          const scrapers = external ? externalScrapers(stub, external) : [];
          next.repositories = [
            ...next.repositories,
            { ...stub, metadata: external || stub.metadata, scraperCount: scrapers.length }
          ];
          next.scrapers = [
            ...next.scrapers.filter((entry) => entry.repositoryId !== stub.id),
            ...scrapers
          ];
        }
      }
      // A local add/remove/toggle may have happened while a remote manifest was
      // being hydrated. Never commit the stale working copy over that newer
      // local state; the caller will flush its pending dirty snapshot instead.
      if (!reconcileRevisionChanges()) {
        logPluginDiagnostic("reconcile stopped", {
          targetProfileId: String(targetProfileId),
          reason: "local revision changed during hydration",
          ...diagnosticState(next)
        });
        return next;
      }
      if (removeMissingLocal && (incoming.length || canApplyVerifiedEmptySnapshot)) {
        const remoteIdentities = new Set(incoming.map((entry) => repositoryIdentity(entry.url)));
        const removed = next.repositories.filter(
          (entry) => !remoteIdentities.has(repositoryIdentity(entry.url))
        );
        await Promise.all(
          removed
            .filter((entry) => entry.type === PLUGIN_REPOSITORY_TYPES.NUVIO_JS)
            .flatMap((entry) =>
              next.scrapers
                .filter((scraper) => scraper.repositoryId === entry.id)
                .map((scraper) => scraper.id)
            )
            .map((id) => PluginCodeStore.remove(id, targetProfileId))
        );
        // A successful typed snapshot is authoritative, just like Android's
        // complete remote list. Callers that consume an older/partial source
        // can omit authoritativeSnapshot and retain opaque local entries.
        const opaqueTypes = [
          PLUGIN_REPOSITORY_TYPES.UNKNOWN,
          PLUGIN_REPOSITORY_TYPES.LEGACY,
          PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX
        ];
        next.repositories = next.repositories.filter(
          (entry) =>
            remoteIdentities.has(repositoryIdentity(entry.url)) ||
            (!authoritativeSnapshot && opaqueTypes.includes(entry.type))
        );
        next.scrapers = next.scrapers.filter((entry) =>
          next.repositories.some((repo) => repo.id === entry.repositoryId)
        );
      }
      const ordered = incoming
        .map((entry) =>
          next.repositories.find(
            (repo) => repositoryIdentity(repo.url) === repositoryIdentity(entry.url)
          )
        )
        .filter(Boolean);
      const extras = next.repositories.filter(
        (repo) =>
          !incoming.some((entry) => repositoryIdentity(entry.url) === repositoryIdentity(repo.url))
      );
      if (!reconcileRevisionChanges()) {
        logPluginDiagnostic("reconcile stopped", {
          targetProfileId: String(targetProfileId),
          reason: "local revision changed before commit",
          ...diagnosticState(next)
        });
        return next;
      }
      const preservedUnknownRows = authoritativeSnapshot
        ? unknownRemoteRows
        : [...state.unknownRemoteRows, ...unknownRemoteRows];
      PluginStore.replace(
        {
          ...next,
          repositories: ordered.concat(extras),
          // A complete remote snapshot also makes previously preserved opaque
          // rows stale; partial callers keep the old safety behavior.
          unknownRemoteRows: preservedUnknownRows
            .filter((entry, index, values) => {
              const key = JSON.stringify(entry || {});
              return (
                values.findIndex((candidate) => JSON.stringify(candidate || {}) === key) === index
              );
            })
            .slice(0, 256),
          rawRemoteRows: incoming.map((entry) => entry.raw || entry),
          syncDirty: state.syncDirty
        },
        targetProfileId
      );
      const committed = PluginStore.get(targetProfileId);
      logPluginDiagnostic("reconcile committed", {
        targetProfileId: String(targetProfileId),
        preservedUnknownRows: preservedUnknownRows.length,
        ...diagnosticState(committed)
      });
      return committed;
    });
  },

  async executeScrapersStreaming({
    tmdbId,
    mediaType,
    season = null,
    episode = null,
    signal = null,
    onGroup = null
  } = {}) {
    if (!this.pluginsEnabled || signal?.aborted) return [];
    const capabilities = getPluginCapabilitySnapshot();
    if (!capabilities.candidate) return [];
    try {
      await this.ensureRuntime();
    } catch (_) {
      return [];
    }
    const quota = quotaFor(capabilities);
    const state = currentState();
    const args = {
      tmdbId: String(tmdbId || ""),
      mediaType: String(mediaType || ""),
      season,
      episode
    };
    const eligible = executableScrapersForMediaType(state, mediaType);
    if (!eligible.length) return [];
    const completedGroups = [];
    const emit = typeof onGroup === "function" ? onGroup : null;
    let emittedCount = 0;
    const createGroup = (scraper, repository, streams) => ({
      // Android identifies a provider by its scraper when it exposes the
      // source metadata, while the visible name changes to the repository
      // when grouping is enabled. Keep that same distinction here.
      sourceId: this.groupStreamsByRepository ? repository.id : scraper.id,
      sourceName: this.groupStreamsByRepository ? repository.name : scraper.name,
      sourceLogo: null,
      repositoryId: repository.id,
      repositoryName: repository.name,
      streams: Array.isArray(streams) ? streams : []
    });
    const emitGroup = ({ scraper, repository, streams }) => {
      if (!emit || signal?.aborted || emittedCount >= quota.maxResults) return;
      const limited = (Array.isArray(streams) ? streams : []).slice(
        0,
        Math.max(0, quota.maxResults - emittedCount)
      );
      if (!limited.length) return;
      emittedCount += limited.length;
      try {
        emit(createGroup(scraper, repository, limited));
      } catch (error) {
        logPluginDiagnostic("plugin stream chunk callback failed", {
          repository: diagnosticRepository(repository),
          scraperId: String(scraper?.id || "").slice(0, 128),
          error: diagnosticError(error)
        });
      }
    };
    await Promise.all(
      eligible.map(async (scraper, index) => {
        const repository = state.repositories.find((entry) => entry.id === scraper.repositoryId);
        await delayWithSignal(index * 60, signal);
        if (signal?.aborted || !repository) return;
        const streams = await executeOne(scraper, repository, args, quota, signal);
        const group = { scraper, repository, streams };
        // Android's Flow emits groups in completion order. Keep that order for
        // callers that consume the final list without the progressive callback.
        completedGroups.push(group);
        emitGroup(group);
      })
    );
    if (signal?.aborted) return [];

    // Android's streaming path emits one complete result list per scraper and
    // merges groups with the same visible addon name downstream. Preserve the
    // provider boundary here; only the Web quota limits the total returned
    // result count.
    const output = [];
    let outputCount = 0;
    const grouped = new Map();
    completedGroups.forEach((group) => {
      if (!group || outputCount >= quota.maxResults) return;
      const streams = (Array.isArray(group.streams) ? group.streams : []).slice(
        0,
        Math.max(0, quota.maxResults - outputCount)
      );
      if (!streams.length) return;
      const entry = createGroup(group.scraper, group.repository, streams);
      outputCount += streams.length;
      if (this.groupStreamsByRepository) {
        const existing = grouped.get(entry.sourceId);
        if (existing) existing.streams.push(...entry.streams);
        else grouped.set(entry.sourceId, entry);
      } else {
        output.push(entry);
      }
    });
    if (this.groupStreamsByRepository) output.push(...grouped.values());
    return output;
  },

  async testScraper(scraperId, { tmdbId = "603", signal = null } = {}) {
    // Android's explicit provider test is independent from the global stream
    // discovery toggle; only normal playback execution uses pluginsEnabled.
    if (signal?.aborted) {
      return { results: [], tmdbId: String(tmdbId), mediaType: "movie" };
    }
    const capabilities = getPluginCapabilitySnapshot();
    if (!capabilities.candidate) throw new Error(capabilities.reason);
    await this.ensureRuntime();
    const state = currentState();
    const scraper = state.scrapers.find((entry) => entry.id === scraperId);
    const repository = state.repositories.find((entry) => entry.id === scraper?.repositoryId);
    if (
      !scraper ||
      !repository ||
      scraper.codeAvailable === false ||
      !isExecutableScraper(scraper, repository, platformId())
    ) {
      throw new Error("JS scraper is unavailable on this TV runtime");
    }
    const mediaType = pluginSupportsType(scraper.supportedTypes, "movie") ? "movie" : "series";
    const season = mediaType === "movie" ? null : 1;
    const episode = mediaType === "movie" ? null : 1;
    const testId = String(tmdbId || "603");
    const diagnostics = {
      steps: [
        `Scraper: ${scraper.name} (type=${scraper.type})`,
        `Test: TMDB ${testId} (${mediaType})`,
        "Executing JS scraper..."
      ]
    };
    try {
      const results = await executeOne(
        scraper,
        repository,
        { tmdbId: testId, mediaType, season, episode },
        quotaFor(capabilities),
        signal,
        { throwOnError: true, mapResults: false }
      );
      diagnostics.steps.push(`Result: ${results.length} streams`);
      return { results, tmdbId: testId, mediaType, season, episode, diagnostics };
    } catch (error) {
      diagnostics.steps.push(
        `Exception: ${error?.name || "Error"}: ${String(error?.message || error)}`
      );
      return { results: [], tmdbId: testId, mediaType, season, episode, diagnostics };
    }
  },

  setScraperSettings(scraperId, settings) {
    if (!canEdit()) return false;
    const state = currentState();
    PluginStore.replace({
      ...state,
      settings: {
        ...state.settings,
        scraperSettings: {
          ...state.settings.scraperSettings,
          [scraperId]: settings && typeof settings === "object" ? settings : {}
        }
      },
      // Per-scraper settings are local-only on Android and have no remote row.
      syncDirty: state.syncDirty
    });
    return true;
  },

  async clearCache() {
    await PluginCodeStore.clear(getEffectivePluginProfileId());
    PluginServiceClient.resetHealthCache();
    try {
      await PluginServiceClient.clearCache();
    } catch (_) {
      // A local code-cache clear is still useful when the optional service
      // cache endpoint is unavailable. Never make this action destructive to
      // repositories or provider settings.
    }
    return true;
  },

  addPluginSource(source) {
    return PluginRuntime.addSource(source);
  },

  removePluginSource(sourceId) {
    return PluginRuntime.removeSource(sourceId);
  },

  setPluginSourceEnabled(sourceId, enabled) {
    return PluginRuntime.setSourceEnabled(sourceId, enabled);
  }
};
