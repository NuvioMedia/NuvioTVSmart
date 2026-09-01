import { PluginStore, getEffectivePluginProfileId } from "../../data/local/pluginStore.js";
import { PluginCodeStore } from "../../data/local/pluginCodeStore.js";
import { PluginRuntime } from "./pluginRuntime.js";
import { PluginExecutionFlight } from "./pluginExecutionFlight.js";
import { PluginServiceClient } from "../../platform/pluginServiceClient.js";
import { Platform } from "../../platform/index.js";
import { getPluginCapabilitySnapshot } from "./pluginPolicy.js";
import {
  canonicalizePluginUrl,
  isExecutablePluginRepository,
  isExecutableScraper,
  normalizeExternalRepositoryMetadata,
  normalizePluginManifest,
  normalizePluginRepositoryType,
  normalizePluginState,
  pluginSupportsType,
  repositoryIdForUrl,
  resolvePluginUrl,
  isPluginShortCode,
  isVideoEasyScraper,
  isExternalDexRepository,
  sanitizePluginRepositoryInput,
  safePluginId,
  scraperIdForManifest,
  stablePluginHash,
  PLUGIN_REPOSITORY_TYPES
} from "./pluginModels.js";
import { PLUGIN_QUOTAS } from "./pluginPolicy.js";
import { validatePluginUrl } from "./pluginSecurity.js";
import { I18n } from "../../i18n/index.js";

const singleFlight = new PluginExecutionFlight();
const queuedExecutions = [];
let runningExecutions = 0;
let runtimeReadyPromise = null;
export const ANDROID_PLUGIN_MANAGEMENT_USER_AGENT = "NuvioTV/1.0";

function currentState() {
  return normalizePluginState(PluginStore.get());
}

function canEdit() {
  return PluginStore.canEdit();
}

function platformId() {
  return Platform.getName();
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
      return {
        id: androidResultString(subtitle.id) || url,
        url,
        lang,
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

async function mergeRepositoryScrapers(state, repository, manifest) {
  const previous = state.scrapers.filter((entry) => entry.repositoryId === repository.id);
  const previousByKey = new Map(
    previous.map((entry) => [`${entry.manifestId || entry.filename}`, entry])
  );
  const scrapers = await Promise.all(
    manifest.scrapers.map(async (entry) => {
      const id = scraperIdForManifest(repository.id, entry.id, entry.filename);
      const old = previousByKey.get(`${entry.id}`) || previousByKey.get(`${entry.filename}`) || {};
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
        codeAvailable: Boolean(await PluginCodeStore.get(id)),
        codeUrl: resolvePluginUrl(entry.codeUrl || entry.filename, repository.url),
        supportedPlatforms: entry.supportedPlatforms || [],
        disabledPlatforms: entry.disabledPlatforms || []
      };
    })
  );
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
    console.warn(`Plugin short-code resolution failed for ${normalizedCode}:`, error);
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
      console.warn("CloudStream metadata list refresh failed:", error);
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
  // The extension is an unambiguous CloudStream binary marker. Even a stale
  // or malicious cloud row claiming NUVIO_JS must never make Web TV fetch it
  // as a JavaScript manifest.
  if (/\.cs3(?:$|[?#])/i.test(url)) {
    return { type: PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX, url };
  }
  // A future/unknown explicit enum is not safe to reinterpret from its URL or
  // document. Preserve it as an opaque row until a client understands it.
  if (hasExplicitType && explicitType === PLUGIN_REPOSITORY_TYPES.UNKNOWN) {
    return { type: PLUGIN_REPOSITORY_TYPES.UNKNOWN, url };
  }
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
          return {
            type: PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX,
            url,
            document: loaded.document,
            metadata
          };
        }
        if (manifest && Array.isArray(loaded.document?.scrapers)) {
          return {
            type: PLUGIN_REPOSITORY_TYPES.NUVIO_JS,
            url: loaded.sourceUrl,
            document: loaded.document,
            manifest
          };
        }
        if (metadata) {
          return {
            type: PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX,
            url,
            document: loaded.document,
            metadata
          };
        }
      } catch (error) {
        console.warn(
          "Typed plugin repository detection failed; falling back to auto-detection:",
          error
        );
      }
    }
    if (
      explicitType !== PLUGIN_REPOSITORY_TYPES.NUVIO_JS &&
      explicitType !== PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX
    ) {
      return { type: explicitType, url };
    }
  }
  try {
    const loaded = await fetchRepositoryDocument(url, quota);
    const preferExternal = isExplicitExternalJsonEndpoint(url);
    const manifest = normalizePluginManifest(loaded.document, loaded.sourceUrl);
    const external = await loadExternalMetadata(loaded.document, loaded.sourceUrl, quota);
    if (preferExternal && external) {
      return {
        type: PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX,
        url,
        document: loaded.document,
        metadata: external
      };
    }
    if (manifest && Array.isArray(loaded.document?.scrapers)) {
      return {
        type: PLUGIN_REPOSITORY_TYPES.NUVIO_JS,
        url: loaded.sourceUrl,
        document: loaded.document,
        manifest
      };
    }
    if (external) {
      return {
        type: PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX,
        url,
        document: loaded.document,
        metadata: external
      };
    }
  } catch (error) {
    console.warn("Plugin repository type detection failed:", error);
  }
  return { type: PLUGIN_REPOSITORY_TYPES.UNKNOWN, url };
}

async function downloadCode(scraper, repository, quota) {
  const existing = await PluginCodeStore.get(scraper.id);
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
    if (
      !(await PluginCodeStore.save(
        scraper.id,
        response.body,
        { url: scraper.codeUrl, version: scraper.version },
        { maxBytes: quota.maxCacheBytes }
      ))
    ) {
      throw new Error("Plugin code cache quota exceeded");
    }
    return true;
  } catch (error) {
    console.warn(`Plugin code download failed for ${repository.name}/${scraper.name}:`, error);
    return Boolean(existing?.code);
  }
}

async function hydrateJsRepository(state, repository, manifest, { markDirty = false } = {}) {
  const quota = quotaFor();
  const previousIds = state.scrapers
    .filter((entry) => entry.repositoryId === repository.id)
    .map((entry) => entry.id);
  let next = await mergeRepositoryScrapers(state, repository, manifest);
  const nextIds = new Set(
    next.scrapers.filter((entry) => entry.repositoryId === repository.id).map((entry) => entry.id)
  );
  await Promise.all(
    previousIds.filter((id) => !nextIds.has(id)).map((id) => PluginCodeStore.remove(id))
  );
  const hydrated = [];
  for (const scraper of next.scrapers.filter((entry) => entry.repositoryId === repository.id)) {
    const codeAvailable = await downloadCode(scraper, repository, quota);
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
  return normalizePluginState(next);
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

async function clearRepositoryExecution(state, repositoryId) {
  await Promise.all(
    state.scrapers
      .filter((entry) => entry.repositoryId === repositoryId)
      .map((entry) => PluginCodeStore.remove(entry.id))
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
  metadata = null
) {
  const cleaned = await clearRepositoryExecution(state, existing.id);
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

async function hydrateDetectedJsRepository(state, existing, remote, detected) {
  const quota = quotaFor();
  const manifestUrl = canonicalizePluginUrl(detected.url || remote.url, { manifest: true });
  const manifest =
    detected.manifest || normalizePluginManifest(await fetchJson(manifestUrl, quota), manifestUrl);
  if (!manifest) throw new Error("JS repository manifest is invalid");
  const cleaned = await clearRepositoryExecution(state, existing.id);
  return hydrateJsRepository(
    cleaned,
    {
      ...existing,
      url: manifestUrl,
      name: manifest.name,
      description: manifest.description,
      type: PLUGIN_REPOSITORY_TYPES.NUVIO_JS
    },
    manifest
  );
}

function createRemoteStub(remote = {}) {
  const url = canonicalizePluginUrl(remote.url || remote.url_template || remote.urlTemplate);
  const declaredType = normalizePluginRepositoryType(
    remote.repoType || remote.repo_type || remote.type,
    PLUGIN_REPOSITORY_TYPES.UNKNOWN
  );
  const type = /\.cs3(?:$|[?#])/i.test(url) ? PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX : declaredType;
  // A repository URL is the portable identity shared by Android, Web and the
  // cloud row. Do not let a database row id or a remote display id create
  // cross-device cache collisions.
  const id = repositoryIdForUrl(url) || safePluginId(remote.id, "repository");
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
    enabled: remote.enabled !== false,
    type,
    lastUpdated: 0,
    scraperCount: 0,
    metadata: remote.raw || remote
  };
}

async function runWithPool(task, quota, signal) {
  if (signal?.aborted) return [];
  if (runningExecutions >= quota.maxConcurrent) {
    if (queuedExecutions.length >= quota.maxQueued) return [];
    return new Promise((resolve) => {
      queuedExecutions.push({ task, resolve, signal });
    });
  }
  runningExecutions += 1;
  try {
    return await task();
  } finally {
    runningExecutions = Math.max(0, runningExecutions - 1);
    const next = queuedExecutions.shift();
    if (next) {
      runWithPool(next.task, quota, next.signal)
        .then(next.resolve)
        .catch(() => next.resolve([]));
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
  let code = await PluginCodeStore.get(scraper.id);
  if (!code?.code && scraper.codeUrl) {
    await downloadCode(scraper, repository, quota);
    code = await PluginCodeStore.get(scraper.id);
  }
  if (!code?.code) return [];
  const executionProfileId = getEffectivePluginProfileId();
  const executionSettings = currentState().settings.scraperSettings?.[scraper.id] || {};
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
              timeoutMs: quota.globalTimeoutMs,
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
      console.warn(`Plugin scraper ${scraper.name} failed:`, error);
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

  getRuntimeStatus({ probe = false } = {}) {
    if (!probe) return Promise.resolve(this.getCapabilitySnapshot());
    return this.ensureRuntime()
      .then(() => this.getCapabilitySnapshot())
      .catch(() => this.getCapabilitySnapshot());
  },

  async ensureRuntime() {
    const capabilities = getPluginCapabilitySnapshot();
    if (!capabilities.candidate) {
      markRuntime("unsupported", capabilities.reason);
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
          return true;
        })
        .catch((error) => {
          runtimeReadyPromise = null;
          markRuntime("error", error?.message || error);
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
      syncDirty: true
    });
    return true;
  },

  setGroupStreamsByRepository(enabled) {
    if (!canEdit()) return false;
    const state = currentState();
    PluginStore.replace({
      ...state,
      settings: { ...state.settings, groupStreamsByRepository: Boolean(enabled) },
      syncDirty: true
    });
    return true;
  },

  async addRepository(input) {
    if (!canEdit()) throw new Error("Plugin settings are read-only for this profile");
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
      const state = currentState();
      const repositoryKey = repositoryIdentity(repository.url);
      if (!state.repositories.some((entry) => repositoryIdentity(entry.url) === repositoryKey)) {
        PluginStore.replace({
          ...state,
          repositories: [...state.repositories, repository],
          syncDirty: true
        });
      }
      return repository;
    }
    const normalizedUrl = canonicalizePluginUrl(rawUrl);
    const validation = validatePluginUrl(normalizedUrl);
    if (!validation.ok) throw new Error(validation.reason);
    const state = currentState();
    const identity = repositoryIdentity(normalizedUrl);
    const existing = state.repositories.find(
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
      PluginStore.replace(next);
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
        id: repositoryIdForUrl(sourceUrl),
        name: manifest.name,
        url: canonicalizePluginUrl(sourceUrl),
        description: manifest.description,
        enabled:
          state.repositories.find((entry) => entry.url === canonicalizePluginUrl(sourceUrl))
            ?.enabled !== false,
        type: PLUGIN_REPOSITORY_TYPES.NUVIO_JS
      };
      const next = await hydrateJsRepository(state, repository, manifest, { markDirty: true });
      PluginStore.replace(next);
      return repository;
    }
    if (external) return saveExternalRepository();
    throw new Error("Repository format is not supported");
  },

  async refreshRepository(repositoryId) {
    if (!canEdit()) throw new Error("Plugin settings are read-only for this profile");
    const state = currentState();
    const repository = state.repositories.find((entry) => entry.id === repositoryId);
    if (!repository) throw new Error("Repository not found");
    if (!isExecutablePluginRepository(repository)) {
      if (
        repository.type === PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX &&
        !/\.cs3(?:$|[?#])/i.test(repository.url)
      ) {
        const loaded = await fetchRepositoryDocument(repository.url, quotaFor());
        const external = await loadExternalMetadata(loaded.document, loaded.sourceUrl, quotaFor());
        if (!external) throw new Error("CloudStream repository metadata is invalid");
        const scrapers = externalScrapers(repository, external);
        PluginStore.replace({
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
          syncDirty: true
        });
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
      { markDirty: true }
    );
    PluginStore.replace(next);
    return { ok: true };
  },

  async removeRepository(repositoryId) {
    if (!canEdit()) return false;
    const state = currentState();
    const repository = state.repositories.find((entry) => entry.id === repositoryId);
    if (
      !repository ||
      repository.type === PLUGIN_REPOSITORY_TYPES.UNKNOWN ||
      isExternalDexRepository(repository)
    )
      return false;
    const scraperIds = state.scrapers
      .filter((entry) => entry.repositoryId === repositoryId)
      .map((entry) => entry.id);
    await Promise.all(scraperIds.map((id) => PluginCodeStore.remove(id)));
    PluginStore.replace({
      ...state,
      repositories: state.repositories.filter((entry) => entry.id !== repositoryId),
      scrapers: state.scrapers.filter((entry) => entry.repositoryId !== repositoryId),
      syncDirty: true
    });
    return true;
  },

  setRepositoryEnabled(repositoryId, enabled) {
    if (!canEdit()) return false;
    const state = currentState();
    const repository = state.repositories.find((entry) => entry.id === repositoryId);
    if (!repository || isExternalDexRepository(repository)) return false;
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
      syncDirty: true
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
      syncDirty: true
    });
    return true;
  },

  async reconcileWithRemoteRepoUrls(remotePlugins = [], { removeMissingLocal = true } = {}) {
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
    const state = currentState();
    if (!incoming.length) return state;
    let next = { ...state };
    const unknownRemoteRows = [];
    for (const remote of incoming) {
      const detected = await classifyRemoteRepository(remote, quotaFor());
      const type = detected.type;
      const detectedRemote = { ...remote, url: detected.url || remote.url, repoType: type };
      const remoteIdentity = repositoryIdentity(remote.url);
      const detectedIdentity = repositoryIdentity(detectedRemote.url);
      const existing = next.repositories.find((entry) => {
        const localIdentity = repositoryIdentity(entry.url);
        return (
          localIdentity && (localIdentity === remoteIdentity || localIdentity === detectedIdentity)
        );
      });
      if (existing) {
        if (type === PLUGIN_REPOSITORY_TYPES.UNKNOWN) {
          unknownRemoteRows.push(remote.raw || remote);
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
          next = await replaceRepositoryAsNonExecutable(next, existing, remote, detected, external);
          continue;
        }
        if (
          type === PLUGIN_REPOSITORY_TYPES.NUVIO_JS &&
          existing.type !== PLUGIN_REPOSITORY_TYPES.NUVIO_JS
        ) {
          try {
            next = await hydrateDetectedJsRepository(next, existing, remote, detected);
          } catch (error) {
            console.warn("Plugin sync JS repository rehydration failed:", error);
          }
        }
        continue;
      }
      if (type === PLUGIN_REPOSITORY_TYPES.UNKNOWN) {
        unknownRemoteRows.push(remote.raw || remote);
        next.repositories = [...next.repositories, createRemoteStub(detectedRemote)];
        continue;
      }
      if (type === PLUGIN_REPOSITORY_TYPES.NUVIO_JS) {
        try {
          const manifestUrl = detected.url || canonicalizePluginUrl(remote.url, { manifest: true });
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
              manifest
            );
        } catch (error) {
          console.warn("Plugin sync JS repository hydration failed:", error);
          next.repositories = [
            ...next.repositories,
            createRemoteStub({ ...remote, repoType: type })
          ];
        }
      } else {
        const stub = createRemoteStub({ ...detectedRemote, repoType: type });
        const external =
          detected.metadata || normalizeExternalRepositoryMetadata(detected.document, detected.url);
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
    if (removeMissingLocal) {
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
          .map((id) => PluginCodeStore.remove(id))
      );
      // A DEX or future/opaque repository is outside this client's delete
      // authority. Keep it even when an older server response omits the row;
      // Android may execute/reconcile DEX locally, but Web must never turn a
      // partial/legacy cloud response into a destructive DEX removal.
      next.repositories = next.repositories.filter(
        (entry) =>
          remoteIdentities.has(repositoryIdentity(entry.url)) ||
          [
            PLUGIN_REPOSITORY_TYPES.UNKNOWN,
            PLUGIN_REPOSITORY_TYPES.LEGACY,
            PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX
          ].includes(entry.type)
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
    PluginStore.replace({
      ...next,
      repositories: ordered.concat(extras),
      unknownRemoteRows: [...state.unknownRemoteRows, ...unknownRemoteRows]
        .filter((entry, index, values) => {
          const key = JSON.stringify(entry || {});
          return values.findIndex((candidate) => JSON.stringify(candidate || {}) === key) === index;
        })
        .slice(0, 256),
      rawRemoteRows: incoming.map((entry) => entry.raw || entry),
      syncDirty: state.syncDirty
    });
    return PluginStore.get();
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
    const eligible = state.scrapers.filter((scraper) => {
      const repository = state.repositories.find((entry) => entry.id === scraper.repositoryId);
      return (
        isExecutableScraper(scraper, repository, platformId()) &&
        scraper.codeAvailable !== false &&
        pluginSupportsType(scraper.supportedTypes, mediaType)
      );
    });
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
        console.warn("Plugin stream chunk callback failed", error);
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
      syncDirty: true
    });
    return true;
  },

  async clearCache() {
    await PluginCodeStore.clear();
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
