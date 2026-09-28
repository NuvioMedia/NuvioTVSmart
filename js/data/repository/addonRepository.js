import { safeApiCall } from "../../core/network/safeApiCall.js";
import { LocalStore } from "../../core/storage/localStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { AddonApi } from "../remote/api/addonApi.js";

const ADDON_URLS_KEY = "installedAddonUrls";
const ADDON_DISPLAY_NAMES_KEY = "installedAddonDisplayNames";
const ADDON_ENABLED_STATES_KEY = "installedAddonEnabledStates";
const PROFILES_KEY = "profiles";
const PROFILE_SCOPED_VERSION = 1;
const MANIFEST_SUFFIX = "/manifest.json";
const DEFAULT_ADDON_URLS = ["https://v3-cinemeta.strem.io", "https://opensubtitles-v3.strem.io"];
const MANIFEST_CACHE_KEY = "addonManifestCacheV2";
const MANIFEST_CACHE_VERSION = 2;
const MANIFEST_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MANIFEST_CACHE_MAX_ENTRIES = 128;
const MANIFEST_CACHE_PERSIST_DELAY_MS = 250;

function readBooleanFlag(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1";
  }
  return false;
}

class AddonRepository {
  constructor() {
    this.manifestCache = new Map();
    this.manifestCacheTimestamps = new Map();
    this.manifestErrorCache = new Map();
    this.manifestRequests = new Map();
    this.manifestRefreshRequests = new Map();
    this.manifestCachePersistTimer = null;
    this.installedAddonsCache = null;
    this.installedAddonsCacheKey = "";
    this.installedAddonsPromise = null;
    this.installedAddonsPromiseKey = "";
    this.changeListeners = new Set();
    this.manifestChangeListeners = new Set();
    this.restoreManifestCache();
  }

  restoreManifestCache() {
    const payload = LocalStore.get(MANIFEST_CACHE_KEY, null);
    if (
      !payload ||
      Number(payload.version || 0) !== MANIFEST_CACHE_VERSION ||
      !payload.entries ||
      typeof payload.entries !== "object"
    ) {
      return;
    }

    Object.entries(payload.entries).forEach(([rawBaseUrl, entry]) => {
      const baseUrl = this.canonicalizeUrl(rawBaseUrl);
      const addon = entry?.addon;
      const cachedAtMs = Number(entry?.cachedAtMs || 0);
      if (
        !baseUrl ||
        !Number.isFinite(cachedAtMs) ||
        cachedAtMs <= 0 ||
        !this.isValidManifestCacheAddon(addon, baseUrl)
      ) {
        return;
      }
      this.manifestCache.set(baseUrl, { ...addon, baseUrl });
      this.manifestCacheTimestamps.set(baseUrl, cachedAtMs);
    });
  }

  isValidManifestCacheAddon(addon, baseUrl) {
    return Boolean(
      addon &&
      typeof addon === "object" &&
      this.canonicalizeUrl(addon.baseUrl) === baseUrl &&
      Array.isArray(addon.catalogs) &&
      Array.isArray(addon.resources)
    );
  }

  scheduleManifestCachePersist() {
    if (this.manifestCachePersistTimer) {
      return;
    }
    this.manifestCachePersistTimer = setTimeout(() => {
      this.manifestCachePersistTimer = null;
      const entries = Array.from(this.manifestCache.entries())
        .map(([baseUrl, addon]) => ({
          baseUrl,
          addon,
          cachedAtMs: Number(this.manifestCacheTimestamps.get(baseUrl) || 0)
        }))
        .filter(
          (entry) =>
            entry.cachedAtMs > 0 && this.isValidManifestCacheAddon(entry.addon, entry.baseUrl)
        )
        .sort((left, right) => right.cachedAtMs - left.cachedAtMs)
        .slice(0, MANIFEST_CACHE_MAX_ENTRIES)
        .reduce((accumulator, entry) => {
          accumulator[entry.baseUrl] = {
            cachedAtMs: entry.cachedAtMs,
            addon: entry.addon
          };
          return accumulator;
        }, {});
      LocalStore.set(MANIFEST_CACHE_KEY, {
        version: MANIFEST_CACHE_VERSION,
        entries
      });
    }, MANIFEST_CACHE_PERSIST_DELAY_MS);
  }

  setManifestCacheEntry(baseUrl, addon) {
    const cleanBaseUrl = this.canonicalizeUrl(baseUrl);
    if (!cleanBaseUrl || !this.isValidManifestCacheAddon(addon, cleanBaseUrl)) {
      return;
    }
    this.manifestCache.set(cleanBaseUrl, { ...addon, baseUrl: cleanBaseUrl });
    this.manifestCacheTimestamps.set(cleanBaseUrl, Date.now());
    this.scheduleManifestCachePersist();
  }

  deleteManifestCacheEntry(baseUrl) {
    const cleanBaseUrl = this.canonicalizeUrl(baseUrl);
    const didDelete = this.manifestCache.delete(cleanBaseUrl);
    this.manifestCacheTimestamps.delete(cleanBaseUrl);
    if (didDelete) {
      this.scheduleManifestCachePersist();
    }
    return didDelete;
  }

  isManifestCacheStale(baseUrl) {
    const cleanBaseUrl = this.canonicalizeUrl(baseUrl);
    const cachedAtMs = Number(this.manifestCacheTimestamps.get(cleanBaseUrl) || 0);
    return !cachedAtMs || Date.now() - cachedAtMs >= MANIFEST_CACHE_TTL_MS;
  }

  canonicalizeUrl(url) {
    const trimmed = String(url || "")
      .trim()
      .replace(/\/+$/, "");
    const queryStart = trimmed.indexOf("?");
    const path = queryStart >= 0 ? trimmed.slice(0, queryStart) : trimmed;
    const query = queryStart >= 0 ? trimmed.slice(queryStart) : "";
    const cleanPath = path.toLowerCase().endsWith(MANIFEST_SUFFIX)
      ? path.slice(0, -MANIFEST_SUFFIX.length).replace(/\/+$/, "")
      : path.replace(/\/+$/, "");
    return `${cleanPath}${query}`;
  }

  normalizeUrl(url) {
    return this.normalizeCinemetaUrl(this.canonicalizeUrl(url)).toLowerCase();
  }

  buildManifestUrl(baseUrl) {
    const cleanBaseUrl = this.canonicalizeUrl(baseUrl);
    const queryStart = cleanBaseUrl.indexOf("?");
    const basePath =
      queryStart >= 0 ? cleanBaseUrl.slice(0, queryStart).replace(/\/+$/, "") : cleanBaseUrl;
    const baseQuery = queryStart >= 0 ? cleanBaseUrl.slice(queryStart) : "";
    return `${basePath}/manifest.json${baseQuery}`;
  }

  normalizeManifestAssetUrl(value, baseUrl) {
    const raw = String(value || "").trim();
    if (!raw) {
      return null;
    }
    if (/^\/\//.test(raw)) {
      return `https:${raw}`;
    }
    if (/^(?:https?:|data:|blob:)/i.test(raw)) {
      return raw;
    }
    try {
      const cleanBaseUrl = this.canonicalizeUrl(baseUrl);
      const queryStart = cleanBaseUrl.indexOf("?");
      const basePath =
        queryStart >= 0 ? cleanBaseUrl.slice(0, queryStart).replace(/\/+$/, "") : cleanBaseUrl;
      return new URL(raw, `${basePath}/`).href;
    } catch (_) {
      return raw;
    }
  }

  getActiveStorageProfileId(profileId = null) {
    const raw = String(profileId ?? ProfileManager.getActiveProfileId() ?? "1").trim();
    if (!raw || raw === "1") {
      return "1";
    }

    const storedProfiles = LocalStore.get(PROFILES_KEY, null);
    const activeProfile = Array.isArray(storedProfiles)
      ? storedProfiles.find((profile) => {
          const id = String(profile?.id || profile?.profileIndex || "").trim();
          return id === raw;
        })
      : null;
    const usesPrimaryAddons = readBooleanFlag(
      activeProfile?.usesPrimaryAddons ?? activeProfile?.uses_primary_addons
    );
    return usesPrimaryAddons ? "1" : raw;
  }

  canEdit(profileId = null) {
    const raw = String(profileId ?? ProfileManager.getActiveProfileId() ?? "1").trim() || "1";
    if (raw === "1") {
      return true;
    }
    const storedProfiles = LocalStore.get(PROFILES_KEY, null);
    const profile = Array.isArray(storedProfiles)
      ? storedProfiles.find((entry) => {
          const id = String(entry?.id || entry?.profileIndex || "").trim();
          return id === raw;
        })
      : null;
    return !readBooleanFlag(profile?.usesPrimaryAddons ?? profile?.uses_primary_addons);
  }

  getKnownStorageProfileIds() {
    const storedProfiles = LocalStore.get(PROFILES_KEY, null);
    const ids = Array.isArray(storedProfiles)
      ? storedProfiles
          .map((profile) => String(profile?.id || profile?.profileIndex || "").trim())
          .filter(Boolean)
      : [];
    if (!ids.includes("1")) {
      ids.unshift("1");
    }
    return Array.from(new Set(ids));
  }

  isProfileScopedEnvelope(value) {
    return Boolean(
      value &&
      typeof value === "object" &&
      value.__profileScoped === true &&
      Number(value.version || 0) === PROFILE_SCOPED_VERSION &&
      value.profiles &&
      typeof value.profiles === "object"
    );
  }

  cloneValue(value) {
    if (value == null) {
      return value;
    }
    return JSON.parse(JSON.stringify(value));
  }

  createProfileScopedEnvelope() {
    return {
      __profileScoped: true,
      version: PROFILE_SCOPED_VERSION,
      profiles: {}
    };
  }

  readProfileScopedEnvelope(key, normalizeValue) {
    const raw = LocalStore.get(key, null);
    if (this.isProfileScopedEnvelope(raw)) {
      const next = {
        ...raw,
        profiles: Object.entries(raw.profiles || {}).reduce((accumulator, [profileId, value]) => {
          const normalizedProfileId = this.getActiveStorageProfileId(profileId);
          // If a legacy envelope contains both the primary profile and an
          // inherited secondary copy, the primary value is authoritative.
          // An inherited entry may still seed profile 1 when the primary key
          // is absent, which keeps old installations recoverable.
          if (
            !Object.prototype.hasOwnProperty.call(accumulator, normalizedProfileId) ||
            String(profileId) === normalizedProfileId
          ) {
            accumulator[normalizedProfileId] = normalizeValue(this.cloneValue(value));
          }
          return accumulator;
        }, {})
      };
      if (JSON.stringify(next) !== JSON.stringify(raw)) {
        LocalStore.set(key, next);
      }
      return next;
    }

    const envelope = this.createProfileScopedEnvelope();
    if (raw != null) {
      const normalizedLegacy = normalizeValue(this.cloneValue(raw));
      // Pre-profile addon state was global. Android assigns that legacy state
      // to the primary profile; independent secondary profiles start from
      // their own defaults, while inherited profiles still resolve to 1.
      envelope.profiles["1"] = this.cloneValue(normalizedLegacy);
      LocalStore.set(key, envelope);
    }
    return envelope;
  }

  ensureProfileScopedValue(key, envelope, normalizeValue, defaultValue, profileId = null) {
    const normalizedProfileId = this.getActiveStorageProfileId(profileId);
    if (Object.prototype.hasOwnProperty.call(envelope.profiles, normalizedProfileId)) {
      return envelope.profiles[normalizedProfileId];
    }

    // Android gives an independent profile its own default state. Profiles
    // inheriting the primary state already resolve to storage key "1" above.
    const seed = this.cloneValue(defaultValue);
    envelope.profiles[normalizedProfileId] = normalizeValue(seed);
    LocalStore.set(key, envelope);
    return envelope.profiles[normalizedProfileId];
  }

  readProfileScopedValue(key, normalizeValue, defaultValue, profileId = null) {
    const envelope = this.readProfileScopedEnvelope(key, normalizeValue);
    return this.cloneValue(
      this.ensureProfileScopedValue(key, envelope, normalizeValue, defaultValue, profileId)
    );
  }

  writeProfileScopedValue(key, normalizeValue, value, profileId = null) {
    const envelope = this.readProfileScopedEnvelope(key, normalizeValue);
    const normalizedProfileId = this.getActiveStorageProfileId(profileId);
    envelope.profiles[normalizedProfileId] = normalizeValue(this.cloneValue(value));
    LocalStore.set(key, envelope);
    return envelope.profiles[normalizedProfileId];
  }

  normalizeAddonUrlList(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    const seen = new Set();
    return value
      .map((url) => this.normalizeCinemetaUrl(this.canonicalizeUrl(url)))
      .filter((url) => {
        const key = this.normalizeUrl(url);
        if (!key || seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
  }

  normalizeDisplayNameOverrides(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    return Object.entries(value).reduce((accumulator, [url, name]) => {
      const cleanUrl = this.normalizeCinemetaUrl(this.canonicalizeUrl(url));
      const cleanName = String(name || "").trim();
      if (cleanUrl && cleanName) {
        Object.keys(accumulator)
          .filter((key) => this.normalizeUrl(key) === this.normalizeUrl(cleanUrl))
          .forEach((key) => {
            delete accumulator[key];
          });
        accumulator[cleanUrl] = cleanName;
      }
      return accumulator;
    }, {});
  }

  normalizeAddonEnabledStates(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    return Object.entries(value).reduce((accumulator, [url, enabled]) => {
      const cleanUrl = this.normalizeCinemetaUrl(this.canonicalizeUrl(url));
      if (cleanUrl) {
        Object.keys(accumulator)
          .filter((key) => this.normalizeUrl(key) === this.normalizeUrl(cleanUrl))
          .forEach((key) => {
            delete accumulator[key];
          });
        accumulator[cleanUrl] = enabled == null ? true : readBooleanFlag(enabled);
      }
      return accumulator;
    }, {});
  }

  getInstalledAddonUrls() {
    return this.readProfileScopedValue(
      ADDON_URLS_KEY,
      (value) => this.normalizeAddonUrlList(value),
      DEFAULT_ADDON_URLS
    );
  }

  getAddonEnabledStates() {
    return this.readProfileScopedValue(
      ADDON_ENABLED_STATES_KEY,
      (value) => this.normalizeAddonEnabledStates(value),
      {}
    );
  }

  isAddonEnabled(url) {
    const cleanUrl = this.normalizeCinemetaUrl(this.canonicalizeUrl(url));
    return cleanUrl
      ? this.getAddonMapValue(this.getAddonEnabledStates(), cleanUrl) !== false
      : false;
  }

  getAddonMapValue(map, url) {
    const cleanUrl = this.normalizeCinemetaUrl(this.canonicalizeUrl(url));
    if (!cleanUrl || !map || typeof map !== "object") {
      return undefined;
    }
    if (Object.prototype.hasOwnProperty.call(map, cleanUrl)) {
      return map[cleanUrl];
    }
    const identity = this.normalizeUrl(cleanUrl);
    const matchingEntry = Object.entries(map).find(([key]) => this.normalizeUrl(key) === identity);
    return matchingEntry?.[1];
  }

  setAddonEnabledStates(entries = [], options = {}) {
    const replace = options?.replace !== false;
    const current = replace ? {} : this.getAddonEnabledStates();
    const next = { ...current };
    (entries || []).forEach((entry) => {
      const cleanUrl = this.normalizeCinemetaUrl(
        this.canonicalizeUrl(entry?.url || entry?.baseUrl || entry?.base_url || "")
      );
      if (cleanUrl) {
        Object.keys(next)
          .filter(
            (key) => key !== cleanUrl && this.normalizeUrl(key) === this.normalizeUrl(cleanUrl)
          )
          .forEach((key) => {
            delete next[key];
          });
        next[cleanUrl] = entry?.enabled == null ? true : readBooleanFlag(entry.enabled);
      }
    });
    const changed = JSON.stringify(this.getAddonEnabledStates()) !== JSON.stringify(next);
    if (changed) {
      this.writeProfileScopedValue(
        ADDON_ENABLED_STATES_KEY,
        (value) => this.normalizeAddonEnabledStates(value),
        next
      );
      this.invalidateInstalledAddonsCache();
    }
    return changed;
  }

  getAddonDisplayNameOverrides() {
    return this.readProfileScopedValue(
      ADDON_DISPLAY_NAMES_KEY,
      (value) => this.normalizeDisplayNameOverrides(value),
      {}
    );
  }

  getAddonDisplayNameOverride(url) {
    const cleanUrl = this.normalizeCinemetaUrl(this.canonicalizeUrl(url));
    return cleanUrl
      ? this.getAddonMapValue(this.getAddonDisplayNameOverrides(), cleanUrl) || ""
      : "";
  }

  setAddonDisplayNameOverrides(entries = [], options = {}) {
    const replace = options?.replace !== false;
    const current = replace ? {} : this.getAddonDisplayNameOverrides();
    const next = { ...current };
    (entries || []).forEach((entry) => {
      const cleanUrl = this.normalizeCinemetaUrl(
        this.canonicalizeUrl(entry?.url || entry?.baseUrl || entry?.base_url || "")
      );
      if (!cleanUrl) {
        return;
      }
      const displayName = String(entry?.name || "").trim();
      if (displayName) {
        Object.keys(next)
          .filter(
            (key) => key !== cleanUrl && this.normalizeUrl(key) === this.normalizeUrl(cleanUrl)
          )
          .forEach((key) => {
            delete next[key];
          });
        next[cleanUrl] = displayName;
      } else if (replace) {
        Object.keys(next)
          .filter((key) => this.normalizeUrl(key) === this.normalizeUrl(cleanUrl))
          .forEach((key) => {
            delete next[key];
          });
      }
    });
    const changed = JSON.stringify(this.getAddonDisplayNameOverrides()) !== JSON.stringify(next);
    if (changed) {
      this.writeProfileScopedValue(
        ADDON_DISPLAY_NAMES_KEY,
        (value) => this.normalizeDisplayNameOverrides(value),
        next
      );
      this.invalidateInstalledAddonsCache();
    }
    return changed;
  }

  withDisplayNameOverride(addon = {}) {
    const override = this.getAddonDisplayNameOverride(addon.baseUrl);
    return override && override !== addon.name ? { ...addon, displayName: override } : addon;
  }

  async fetchAddon(baseUrl, options = {}) {
    const cleanBaseUrl = this.canonicalizeUrl(baseUrl);
    const manifestUrl = this.buildManifestUrl(cleanBaseUrl);
    const force = Boolean(options?.force);
    const preferCache = Boolean(options?.preferCache);
    const timeoutMs = options?.timeoutMs;

    if (!force && preferCache) {
      const cached = this.manifestCache.get(cleanBaseUrl);
      if (cached) {
        return { status: "success", data: this.withDisplayNameOverride(cached) };
      }
      const cachedError = this.manifestErrorCache.get(cleanBaseUrl);
      if (cachedError) {
        return cachedError;
      }
    }

    if (!force && this.manifestRequests.has(cleanBaseUrl)) {
      return this.manifestRequests.get(cleanBaseUrl);
    }

    const request = (async () => {
      const result = await safeApiCall(() =>
        AddonApi.getManifest(manifestUrl, timeoutMs === undefined ? {} : { timeoutMs })
      );
      if (result.status === "success") {
        const addon = this.mapManifest(result.data, cleanBaseUrl);
        this.setManifestCacheEntry(cleanBaseUrl, addon);
        this.manifestErrorCache.delete(cleanBaseUrl);
        return { status: "success", data: this.withDisplayNameOverride(addon) };
      }

      const cached = this.manifestCache.get(cleanBaseUrl);
      if (cached) {
        return { status: "success", data: this.withDisplayNameOverride(cached) };
      }

      const fallback = this.getBuiltinFallbackManifest(cleanBaseUrl);
      if (fallback) {
        this.setManifestCacheEntry(cleanBaseUrl, fallback);
        this.manifestErrorCache.delete(cleanBaseUrl);
        return { status: "success", data: this.withDisplayNameOverride(fallback) };
      }

      this.manifestErrorCache.set(cleanBaseUrl, result);
      return result;
    })();

    this.manifestRequests.set(cleanBaseUrl, request);
    try {
      return await request;
    } finally {
      if (this.manifestRequests.get(cleanBaseUrl) === request) {
        this.manifestRequests.delete(cleanBaseUrl);
      }
    }
  }

  invalidateInstalledAddonsCache() {
    this.installedAddonsCache = null;
    this.installedAddonsCacheKey = "";
    this.installedAddonsPromise = null;
    this.installedAddonsPromiseKey = "";
  }

  getCachedInstalledAddons(urls = null, options = {}) {
    const includeDisabled = Boolean(options?.includeDisabled);
    const normalizedUrls = Array.isArray(urls) ? urls : this.getInstalledAddonUrls();
    const selectedUrls = includeDisabled
      ? normalizedUrls
      : normalizedUrls.filter((url) => this.isAddonEnabled(url));
    const addons = selectedUrls
      .map((url) => this.manifestCache.get(this.canonicalizeUrl(url)))
      .filter(Boolean);
    return this.applyDisplayNames(addons);
  }

  async refreshInstalledAddons(options = {}) {
    const includeDisabled = Boolean(options?.includeDisabled);
    const allUrls = this.getInstalledAddonUrls();
    const requestedUrls = Array.isArray(options?.urls) ? options.urls : allUrls;
    const requestedUrlSet = new Set(
      requestedUrls.map((url) => this.canonicalizeUrl(url)).filter(Boolean)
    );
    const urls = allUrls
      .map((url) => this.canonicalizeUrl(url))
      .filter((url, index, values) => values.indexOf(url) === index)
      .filter((url) => requestedUrlSet.has(url))
      .filter((url) => includeDisabled || this.isAddonEnabled(url));
    const timeoutMs = options?.timeoutMs;
    const refreshKey = JSON.stringify({
      profileId: this.getActiveStorageProfileId(),
      urls,
      includeDisabled,
      timeoutMs
    });
    if (this.manifestRefreshRequests.has(refreshKey)) {
      return this.manifestRefreshRequests.get(refreshKey);
    }

    const request = (async () => {
      const previous = new Map(
        urls.map((url) => [url, JSON.stringify(this.manifestCache.get(url) || null)])
      );
      await Promise.all(
        urls.map((url) =>
          this.fetchAddon(url, {
            force: true,
            timeoutMs
          })
        )
      );
      const changed = urls.some(
        (url) => JSON.stringify(this.manifestCache.get(url) || null) !== previous.get(url)
      );
      if (changed) {
        this.invalidateInstalledAddonsCache();
        this.notifyManifestCacheChanged();
      }
      return this.getCachedInstalledAddons(urls, { includeDisabled });
    })();

    this.manifestRefreshRequests.set(refreshKey, request);
    try {
      return await request;
    } finally {
      if (this.manifestRefreshRequests.get(refreshKey) === request) {
        this.manifestRefreshRequests.delete(refreshKey);
      }
    }
  }

  async getInstalledAddons(options = {}) {
    const includeDisabled = Boolean(options?.includeDisabled);
    const allUrls = this.getInstalledAddonUrls();
    const enabledStates = this.getAddonEnabledStates();
    const urls = includeDisabled ? allUrls : allUrls.filter((url) => this.isAddonEnabled(url));
    const cacheKey = JSON.stringify({
      profileId: this.getActiveStorageProfileId(),
      urls,
      displayNames: this.getAddonDisplayNameOverrides(),
      enabledStates,
      includeDisabled
    });
    const force = Boolean(options?.force);
    const cacheOnly = Boolean(options?.cacheOnly);
    const staleWhileRevalidate = Boolean(options?.staleWhileRevalidate);
    const timeoutMs = options?.timeoutMs;

    if (staleWhileRevalidate && !force) {
      const refreshUrls = urls.filter(
        (url) =>
          !this.manifestCache.has(this.canonicalizeUrl(url)) || this.isManifestCacheStale(url)
      );
      if (refreshUrls.length) {
        void this.refreshInstalledAddons({
          urls: refreshUrls,
          includeDisabled,
          timeoutMs
        }).catch((error) => {
          console.warn("Background addon manifest refresh failed", error);
        });
      }
      return this.getCachedInstalledAddons(urls, { includeDisabled });
    }

    if (!force && this.installedAddonsCache && this.installedAddonsCacheKey === cacheKey) {
      return [...this.installedAddonsCache];
    }

    if (cacheOnly) {
      return this.getCachedInstalledAddons(urls, { includeDisabled });
    }

    if (!force && this.installedAddonsPromise && this.installedAddonsPromiseKey === cacheKey) {
      return this.installedAddonsPromise;
    }

    const request = (async () => {
      const fetched = await Promise.all(
        urls.map((url) =>
          this.fetchAddon(url, {
            force,
            preferCache: !force,
            timeoutMs
          })
        )
      );

      const addons = fetched
        .filter((result) => result.status === "success")
        .map((result) => result.data);

      const displayAddons = this.applyDisplayNames(addons);
      if (
        JSON.stringify({
          profileId: this.getActiveStorageProfileId(),
          urls: includeDisabled
            ? this.getInstalledAddonUrls()
            : this.getInstalledAddonUrls().filter((url) => this.isAddonEnabled(url)),
          displayNames: this.getAddonDisplayNameOverrides(),
          enabledStates: this.getAddonEnabledStates(),
          includeDisabled
        }) === cacheKey
      ) {
        this.installedAddonsCache = displayAddons;
        this.installedAddonsCacheKey = cacheKey;
      }
      return [...displayAddons];
    })();

    this.installedAddonsPromise = request;
    this.installedAddonsPromiseKey = cacheKey;
    try {
      return await request;
    } finally {
      if (this.installedAddonsPromise === request) {
        this.installedAddonsPromise = null;
        this.installedAddonsPromiseKey = "";
      }
    }
  }

  async addAddon(url) {
    if (!this.canEdit()) {
      return false;
    }
    const clean = this.normalizeCinemetaUrl(this.canonicalizeUrl(url));
    if (!clean) {
      return;
    }

    const current = this.getInstalledAddonUrls();
    if (current.some((value) => this.normalizeUrl(value) === this.normalizeUrl(clean))) {
      return false;
    }

    this.writeProfileScopedValue(ADDON_URLS_KEY, (value) => this.normalizeAddonUrlList(value), [
      ...current,
      clean
    ]);
    this.setAddonEnabledStates([{ url: clean, enabled: true }], { replace: false });
    this.manifestErrorCache.delete(clean);
    this.invalidateInstalledAddonsCache();
    this.notifyAddonsChanged("add");
    return true;
  }

  async removeAddon(url) {
    if (!this.canEdit()) {
      return false;
    }
    const clean = this.normalizeCinemetaUrl(this.canonicalizeUrl(url));
    const current = this.getInstalledAddonUrls();
    const cleanKey = this.normalizeUrl(clean);
    const removedUrls = current.filter((value) => this.normalizeUrl(value) === cleanKey);
    const next = current.filter((value) => this.normalizeUrl(value) !== cleanKey);
    if (next.length === current.length) {
      return false;
    }
    this.writeProfileScopedValue(
      ADDON_URLS_KEY,
      (value) => this.normalizeAddonUrlList(value),
      next
    );
    const nextEnabledStates = Object.fromEntries(
      Object.entries(this.getAddonEnabledStates()).filter(
        ([key]) => this.normalizeUrl(key) !== cleanKey
      )
    );
    this.writeProfileScopedValue(
      ADDON_ENABLED_STATES_KEY,
      (value) => this.normalizeAddonEnabledStates(value),
      nextEnabledStates
    );
    removedUrls.forEach((removedUrl) => {
      this.deleteManifestCacheEntry(removedUrl);
      this.manifestErrorCache.delete(this.canonicalizeUrl(removedUrl));
    });
    this.invalidateInstalledAddonsCache();
    this.notifyAddonsChanged("remove");
    return true;
  }

  async refreshAddon(url) {
    const clean = this.normalizeCinemetaUrl(this.canonicalizeUrl(url));
    if (!clean) {
      return { status: "error", message: "Invalid addon URL" };
    }

    this.deleteManifestCacheEntry(clean);
    this.manifestErrorCache.delete(clean);
    this.invalidateInstalledAddonsCache();
    const result = await this.fetchAddon(clean, { force: true });
    if (result.status === "success") {
      this.notifyAddonsChanged("refresh");
    }
    return result;
  }

  async setAddonOrder(urls, options = {}) {
    if (options?.allowReadOnly !== true && !this.canEdit()) {
      return false;
    }
    const silent = Boolean(options?.silent);
    const normalized = this.normalizeAddonUrlList(urls || []);
    const current = this.getInstalledAddonUrls();
    const currentEnabledStates = this.getAddonEnabledStates();
    const nextEnabledStates = normalized.reduce((states, url) => {
      states[url] = this.getAddonMapValue(currentEnabledStates, url) !== false;
      return states;
    }, {});
    const changed = JSON.stringify(current) !== JSON.stringify(normalized);
    const enabledStatesChanged =
      JSON.stringify(currentEnabledStates) !== JSON.stringify(nextEnabledStates);
    this.writeProfileScopedValue(
      ADDON_URLS_KEY,
      (value) => this.normalizeAddonUrlList(value),
      normalized
    );
    if (enabledStatesChanged) {
      this.writeProfileScopedValue(
        ADDON_ENABLED_STATES_KEY,
        (value) => this.normalizeAddonEnabledStates(value),
        nextEnabledStates
      );
    }
    if (changed || enabledStatesChanged) {
      const normalizedSet = new Set(normalized.map((url) => this.normalizeUrl(url)));
      current
        .filter((url) => !normalizedSet.has(this.normalizeUrl(url)))
        .forEach((url) => {
          this.deleteManifestCacheEntry(url);
          this.manifestErrorCache.delete(url);
        });
      this.invalidateInstalledAddonsCache();
    }
    if ((changed || enabledStatesChanged) && !silent) {
      this.notifyAddonsChanged("reorder");
    }
    return changed || enabledStatesChanged;
  }

  onInstalledAddonsChanged(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  onManifestCacheChanged(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    this.manifestChangeListeners.add(listener);
    return () => {
      this.manifestChangeListeners.delete(listener);
    };
  }

  notifyAddonsChanged(reason = "unknown") {
    this.invalidateInstalledAddonsCache();
    this.changeListeners.forEach((listener) => {
      try {
        listener(reason);
      } catch (error) {
        console.warn("Addon change listener failed", error);
      }
    });
  }

  notifyManifestCacheChanged() {
    this.manifestChangeListeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        console.warn("Addon manifest change listener failed", error);
      }
    });
  }

  applyDisplayNames(addons) {
    const decoratedAddons = (addons || []).map((addon) => this.withDisplayNameOverride(addon));
    const unrenamed = decoratedAddons.filter((addon) => addon.displayName === addon.name);
    const nameCount = {};
    unrenamed.forEach((addon) => {
      nameCount[addon.name] = (nameCount[addon.name] || 0) + 1;
    });

    const counters = {};
    return decoratedAddons.map((addon) => {
      if (addon.displayName !== addon.name) {
        return addon;
      }
      if ((nameCount[addon.name] || 0) <= 1) {
        return addon;
      }

      counters[addon.name] = (counters[addon.name] || 0) + 1;
      const occurrence = counters[addon.name];
      return {
        ...addon,
        displayName: occurrence === 1 ? addon.name : `${addon.name} (${occurrence})`
      };
    });
  }

  mapManifest(manifest = {}, baseUrl) {
    const types = (manifest.types || []).map((value) => String(value).trim()).filter(Boolean);
    const catalogs = (manifest.catalogs || []).map((catalog) => ({
      id: catalog.id,
      name: catalog.name || catalog.id,
      apiType: (catalog.type || "").trim(),
      extra: this.mapCatalogExtra(catalog),
      pageSize: Number.isFinite(Number(catalog.pageSize)) ? Number(catalog.pageSize) : null,
      showInHome: catalog.showInHome === true,
      hasExplicitShowInHome: catalog.showInHome !== null && catalog.showInHome !== undefined,
      extraSupported: Array.isArray(catalog.extraSupported) ? [...catalog.extraSupported] : [],
      extraRequired: Array.isArray(catalog.extraRequired) ? [...catalog.extraRequired] : []
    }));

    return {
      id: manifest.id || baseUrl,
      name: manifest.name || "Unknown Addon",
      displayName: manifest.name || "Unknown Addon",
      version: manifest.version || "0.0.0",
      description: manifest.description || null,
      logo: this.normalizeManifestAssetUrl(manifest.logo, baseUrl),
      baseUrl,
      types,
      rawTypes: types,
      idPrefixes: Array.isArray(manifest.idPrefixes) ? manifest.idPrefixes : [],
      catalogs,
      resources: this.parseResources(manifest.resources || [], types)
    };
  }

  mapCatalogExtra(catalog = {}) {
    const extras = [];
    const isManifestBoolean = (value) =>
      value === true ||
      (typeof value === "string" && value.trim().toLowerCase() === "true") ||
      (typeof value === "number" && value !== 0);
    const addExtra = (name, isRequired = false, options = null) => {
      const normalizedName = String(name || "").trim();
      if (!normalizedName) {
        return;
      }
      const existing = extras.find(
        (entry) => entry.name.toLowerCase() === normalizedName.toLowerCase()
      );
      if (existing) {
        existing.isRequired = existing.isRequired || isManifestBoolean(isRequired);
        if (!existing.options && Array.isArray(options)) {
          existing.options = options;
        }
        return;
      }
      extras.push({
        // Android normalizes full-form extra names before exposing the manifest
        // to the UI; keep the same canonical representation here.
        name: normalizedName.toLowerCase(),
        isRequired: isManifestBoolean(isRequired),
        options: Array.isArray(options) ? options : null
      });
    };

    (Array.isArray(catalog.extra) ? catalog.extra : []).forEach((entry) => {
      const name = typeof entry === "string" ? entry : entry?.name;
      addExtra(name, entry?.isRequired, entry?.options);
    });

    // Keep legacy extraSupported/extraRequired separate. Android checks those
    // arrays through supportsExtra(), while required-search detection only
    // applies to the full-form `extra` declaration.
    return extras;
  }

  parseResources(resources, defaultTypes) {
    return resources
      .map((resource) => {
        if (typeof resource === "string") {
          return {
            name: resource,
            types: [...defaultTypes],
            idPrefixes: null
          };
        }

        if (resource && typeof resource === "object") {
          return {
            name: resource.name || "",
            types: Array.isArray(resource.types) ? resource.types : [...defaultTypes],
            idPrefixes: Array.isArray(resource.idPrefixes) ? resource.idPrefixes : null
          };
        }

        return null;
      })
      .filter(Boolean);
  }

  getResourceTypes(resource = {}) {
    return (Array.isArray(resource?.types) ? resource.types : [])
      .map((type) => String(type || "").trim())
      .filter(Boolean);
  }

  getResourceIdPrefixes(addon = {}, resource = {}) {
    const prefixes =
      Array.isArray(resource?.idPrefixes) && resource.idPrefixes.length
        ? resource.idPrefixes
        : Array.isArray(addon?.idPrefixes)
          ? addon.idPrefixes
          : [];
    return prefixes.map((prefix) => String(prefix || "").trim()).filter(Boolean);
  }

  resourceSupportsType(resource = {}, type = "") {
    const targetType = String(type || "")
      .trim()
      .toLowerCase();
    if (!targetType) {
      return false;
    }
    const types = this.getResourceTypes(resource).map((resourceType) => resourceType.toLowerCase());
    return !types.length || types.includes(targetType);
  }

  resourceSupportsId(addon = {}, resource = {}, id = "", options = {}) {
    const prefixes = this.getResourceIdPrefixes(addon, resource);
    if (!prefixes.length) {
      return true;
    }
    const rawId = String(id || "");
    if (options?.caseInsensitive) {
      const normalizedId = rawId.toLowerCase();
      return prefixes.some((prefix) => normalizedId.startsWith(prefix.toLowerCase()));
    }
    return prefixes.some((prefix) => rawId.startsWith(prefix));
  }

  resolveResourceRequestType(
    addon = {},
    resourceName = "",
    requestedType = "",
    id = "",
    options = {}
  ) {
    const targetResource = String(resourceName || "")
      .trim()
      .toLowerCase();
    const cleanRequestedType = String(requestedType || "").trim();
    const resources = (addon?.resources || []).filter(
      (resource) =>
        String(resource?.name || "")
          .trim()
          .toLowerCase() === targetResource && this.resourceSupportsId(addon, resource, id, options)
    );
    if (!resources.length) {
      return "";
    }
    if (
      cleanRequestedType &&
      resources.some((resource) => this.resourceSupportsType(resource, cleanRequestedType))
    ) {
      return cleanRequestedType;
    }
    if (!options?.allowIdTypeFallback) {
      return "";
    }

    // A matching ID prefix is strong ownership evidence. Recover a mismatched
    // catalog type only when the owning resource declares one unambiguous type.
    const recoveredTypes = [];
    resources.forEach((resource) => {
      if (!this.getResourceIdPrefixes(addon, resource).length) {
        return;
      }
      const resourceTypes = this.getResourceTypes(resource);
      const candidateTypes = resourceTypes.length
        ? resourceTypes
        : Array.isArray(addon?.rawTypes)
          ? addon.rawTypes
          : addon?.types || [];
      candidateTypes.forEach((type) => {
        const cleanType = String(type || "").trim();
        if (
          cleanType &&
          !recoveredTypes.some((existing) => existing.toLowerCase() === cleanType.toLowerCase())
        ) {
          recoveredTypes.push(cleanType);
        }
      });
    });
    return recoveredTypes.length === 1 ? recoveredTypes[0] : "";
  }

  normalizeCinemetaUrl(url) {
    return String(url || "").replace(
      /https?:\/\/cinemeta-v3\.strem\.io/i,
      "https://v3-cinemeta.strem.io"
    );
  }

  getBuiltinFallbackManifest(baseUrl) {
    if (this.canonicalizeUrl(baseUrl) !== "https://v3-cinemeta.strem.io") {
      return null;
    }

    return {
      id: "org.cinemeta",
      name: "Cinemeta",
      displayName: "Cinemeta",
      version: "fallback",
      description: "Fallback Cinemeta manifest",
      logo: null,
      baseUrl: "https://v3-cinemeta.strem.io",
      types: ["movie", "series"],
      rawTypes: ["movie", "series"],
      resources: [
        { name: "catalog", types: ["movie", "series"], idPrefixes: null },
        { name: "meta", types: ["movie", "series"], idPrefixes: null }
      ],
      catalogs: [
        {
          id: "top",
          name: "Top Movies",
          apiType: "movie",
          extra: [{ name: "search" }]
        },
        {
          id: "top",
          name: "Top Series",
          apiType: "series",
          extra: [{ name: "search" }]
        }
      ]
    };
  }
}

export const addonRepository = new AddonRepository();
