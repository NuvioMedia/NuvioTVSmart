import { MediaServerRepository, parseServerItem } from "../mediaserver/mediaServerRepository.js";
import { safeApiCall } from "../../core/network/safeApiCall.js";
import { addonRepository } from "./addonRepository.js";
import { MetaApi } from "../remote/api/metaApi.js";
import { normalizeTmdbLogoUrl } from "../../core/tmdb/tmdbImageUrl.js";
import { BoundedCache } from "../../core/util/boundedCache.js";

const INSTALLED_ADDONS_WAIT_MS = 750;
// Android keeps 32 entries per meta cache; each title is stored under its
// requested and inferred types, so 200 keys hold a comparable working set.
const MAX_META_CACHE_ENTRIES = 200;

function normalizeDisplayText(value) {
  return String(value ?? "")
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"');
}

function firstNonBlank(...values) {
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

class MetaRepository {
  constructor() {
    this.metaCache = new BoundedCache(MAX_META_CACHE_ENTRIES);
    this.inFlightMeta = new Map();
    this.inFlightMetaAll = new Map();
  }

  async getMeta(addonBaseUrl, type, id) {
    if (String(addonBaseUrl || "").startsWith("nuvio-server://")) {
      if (!parseServerItem(id)) return { status: "error", message: "servers_failure_not_found" };
      try {
        const data = await MediaServerRepository.meta(id);
        return data
          ? { status: "success", data }
          : { status: "error", message: "servers_failure_not_found" };
      } catch (_) {
        return { status: "error", message: "servers_failure_unreachable" };
      }
    }
    const requestedType = String(type || "").trim();
    const normalizedId = String(id || "").trim();
    const inferredType = this.inferCanonicalType(requestedType, normalizedId);
    const addonKey = addonRepository.canonicalizeUrl(addonBaseUrl);
    const probeTypes = [requestedType, inferredType].filter(
      (candidate, index, values) =>
        candidate &&
        values.findIndex((value) => value.toLowerCase() === candidate.toLowerCase()) === index
    );
    for (const probeType of probeTypes) {
      const probeKey = `${addonKey}:${probeType}:${normalizedId}`;
      if (this.metaCache.has(probeKey)) {
        return { status: "success", data: this.metaCache.get(probeKey) };
      }
    }

    const effectiveType = await this.resolveDirectMetaType(
      addonBaseUrl,
      requestedType,
      inferredType,
      normalizedId
    );
    const cacheKey = `${addonKey}:${effectiveType}:${normalizedId}`;
    if (this.metaCache.has(cacheKey)) {
      return { status: "success", data: this.metaCache.get(cacheKey) };
    }
    if (this.inFlightMeta.has(cacheKey)) {
      return this.inFlightMeta.get(cacheKey);
    }

    const request = (async () => {
      const url = this.buildMetaUrl(addonBaseUrl, effectiveType, normalizedId);
      const result = await safeApiCall(() => MetaApi.getMeta(url));
      if (result.status !== "success") {
        return result;
      }

      const meta = this.mapMeta(result.data?.meta || null);
      if (!meta) {
        return { status: "error", message: "Meta not found", code: 404 };
      }

      [effectiveType, requestedType, inferredType].forEach((cacheType) => {
        if (cacheType) {
          this.metaCache.set(`${addonKey}:${cacheType}:${normalizedId}`, meta);
        }
      });
      return { status: "success", data: meta };
    })();

    this.inFlightMeta.set(cacheKey, request);
    try {
      return await request;
    } finally {
      this.inFlightMeta.delete(cacheKey);
    }
  }

  async getMetaFromAllAddons(type, id, sourceAddonBaseUrl = null) {
    if (parseServerItem(id)) {
      try {
        const data = await MediaServerRepository.meta(id);
        return data
          ? { status: "success", data }
          : { status: "error", message: "servers_failure_not_found" };
      } catch (_) {
        return { status: "error", message: "servers_failure_unreachable" };
      }
    }
    const requestedType = String(type || "").trim();
    const inferredType = this.inferCanonicalType(requestedType, id);
    const cacheKey = `all:${inferredType.toLowerCase()}:${String(id || "").trim()}`;
    if (this.metaCache.has(cacheKey)) {
      return { status: "success", data: this.metaCache.get(cacheKey) };
    }

    if (this.inFlightMetaAll.has(cacheKey)) {
      return this.inFlightMetaAll.get(cacheKey);
    }

    const request = (async () => {
      const addons = await addonRepository.getInstalledAddons({ includeMediaServers: true });
      const normalizedSourceUrl = sourceAddonBaseUrl
        ? addonRepository.canonicalizeUrl(sourceAddonBaseUrl)
        : "";
      const candidates = [];
      const seenCandidates = new Set();
      const addCandidate = (addon, candidateType) => {
        const cleanType = String(candidateType || "").trim();
        if (!addon || !cleanType) {
          return;
        }
        const key = `${addon.baseUrl}::${cleanType}`;
        if (seenCandidates.has(key)) {
          return;
        }
        seenCandidates.add(key);
        candidates.push({ addon, type: cleanType });
      };

      // Prefer addons whose explicit idPrefixes identify them as the owner.
      // This also safely recovers `tv` when a secondary catalog forwarded a
      // broader row type such as `channel`.
      addons.forEach((addon) => {
        const hasMatchingPrefix = (addon?.resources || []).some((resource) => {
          if (String(resource?.name || "").toLowerCase() !== "meta") {
            return false;
          }
          return (
            addonRepository.getResourceIdPrefixes(addon, resource).length > 0 &&
            addonRepository.resourceSupportsId(addon, resource, id, {
              caseInsensitive: true
            })
          );
        });
        if (!hasMatchingPrefix) {
          return;
        }
        const ownerType = addonRepository.resolveResourceRequestType(
          addon,
          "meta",
          requestedType,
          id,
          { caseInsensitive: true }
        );
        if (ownerType) {
          addCandidate(addon, ownerType);
        }
      });

      addons.forEach((addon) => {
        const candidateType = addonRepository.resolveResourceRequestType(
          addon,
          "meta",
          requestedType,
          id,
          { caseInsensitive: true }
        );
        if (candidateType) {
          addCandidate(addon, candidateType);
        }
      });
      if (inferredType.toLowerCase() !== requestedType.toLowerCase()) {
        addons.forEach((addon) => {
          const candidateType = addonRepository.resolveResourceRequestType(
            addon,
            "meta",
            inferredType,
            id,
            { caseInsensitive: true }
          );
          if (candidateType) {
            addCandidate(addon, candidateType);
          }
        });
      }

      for (const { addon, type: candidateType } of candidates) {
        // Android treats the catalog/source addon as sufficient for a
        // recommendation candidate: it uses the candidate preview metadata
        // instead of issuing a second detail request to that same addon.
        if (
          normalizedSourceUrl &&
          addonRepository.canonicalizeUrl(addon.baseUrl) === normalizedSourceUrl
        ) {
          return {
            status: "source-sufficient",
            message: "Source addon metadata is sufficient"
          };
        }
        const result = await this.getMeta(addon.baseUrl, candidateType, id);
        if (result.status === "success") {
          this.metaCache.set(cacheKey, result.data);
          return result;
        }
      }

      return { status: "error", message: "Meta not found in installed addons", code: 404 };
    })();

    this.inFlightMetaAll.set(cacheKey, request);
    try {
      return await request;
    } finally {
      this.inFlightMetaAll.delete(cacheKey);
    }
  }

  getCachedMeta(type, id) {
    const requestedType = String(type || "").trim();
    const normalizedId = String(id || "").trim();
    if (!normalizedId) {
      return null;
    }
    const inferredType = this.inferCanonicalType(requestedType, normalizedId);
    const allKey = `all:${inferredType.toLowerCase()}:${normalizedId}`;
    if (this.metaCache.has(allKey)) {
      return this.metaCache.get(allKey);
    }

    const candidateTypes = [requestedType, inferredType]
      .filter(Boolean)
      .filter(
        (candidate, index, values) =>
          values.findIndex((value) => value.toLowerCase() === candidate.toLowerCase()) === index
      );
    for (const candidateType of candidateTypes) {
      const suffix = `:${candidateType}:${normalizedId}`;
      for (const [cacheKey, meta] of this.metaCache.entries()) {
        if (cacheKey.endsWith(suffix)) {
          this.metaCache.get(cacheKey);
          return meta;
        }
      }
    }
    return null;
  }

  buildMetaUrl(baseUrl, type, id) {
    const cleanBaseUrl = addonRepository.canonicalizeUrl(baseUrl);
    const queryStart = cleanBaseUrl.indexOf("?");
    const basePath =
      queryStart >= 0 ? cleanBaseUrl.slice(0, queryStart).replace(/\/+$/, "") : cleanBaseUrl;
    const baseQuery = queryStart >= 0 ? cleanBaseUrl.slice(queryStart) : "";
    return `${basePath}/meta/${this.encode(type)}/${this.encode(id)}.json${baseQuery}`;
  }

  async resolveDirectMetaType(addonBaseUrl, requestedType, inferredType, id) {
    const candidates = [requestedType, inferredType].filter(
      (candidate, index, values) =>
        candidate &&
        values.findIndex((value) => value.toLowerCase() === candidate.toLowerCase()) === index
    );
    if (!candidates.length) {
      return requestedType;
    }
    try {
      const addons = await addonRepository.getInstalledAddons({
        includeMediaServers: true,
        timeoutMs: INSTALLED_ADDONS_WAIT_MS
      });
      const target = addonRepository.canonicalizeUrl(addonBaseUrl);
      const addon = addons.find(
        (entry) => addonRepository.canonicalizeUrl(entry?.baseUrl) === target
      );
      if (!addon) {
        return requestedType;
      }
      for (const candidate of candidates) {
        const supported = addonRepository.resolveResourceRequestType(addon, "meta", candidate, id, {
          caseInsensitive: true
        });
        if (supported) {
          return supported;
        }
      }
    } catch (_) {
      // A manifest lookup must not prevent the direct requested-type fallback.
    }
    return requestedType;
  }

  inferCanonicalType(type, id) {
    const normalizedType = String(type || "").trim();
    const lowerType = normalizedType.toLowerCase();
    // `tv` is Nuvio's internal synonym for episodic content. Metadata addons
    // advertise that resource as `series`; live TV remains `channel`.
    if (lowerType === "tv") {
      return "series";
    }
    const known = new Set(["movie", "series", "channel", "anime"]);
    if (known.has(lowerType)) {
      return normalizedType;
    }
    const normalizedId = String(id || "").toLowerCase();
    if (normalizedId.includes(":movie:")) return "movie";
    if (normalizedId.includes(":series:")) return "series";
    if (normalizedId.includes(":tv:")) return "series";
    if (normalizedId.includes(":anime:")) return "anime";
    return normalizedType;
  }

  encode(value) {
    return encodeURIComponent(String(value || "")).replace(/\+/g, "%20");
  }

  mapMeta(meta) {
    if (
      !meta ||
      typeof meta !== "object" ||
      Array.isArray(meta) ||
      Object.keys(meta).length === 0
    ) {
      return null;
    }

    const appExtras =
      meta.app_extras && typeof meta.app_extras === "object" && !Array.isArray(meta.app_extras)
        ? meta.app_extras
        : meta.appExtras && typeof meta.appExtras === "object" && !Array.isArray(meta.appExtras)
          ? meta.appExtras
          : {};

    return {
      ...meta,
      id: meta.id || "",
      type: meta.type || "",
      name: normalizeDisplayText(meta.name || "Untitled"),
      poster: meta.poster || null,
      background: meta.background || null,
      logo: normalizeTmdbLogoUrl(meta.logo) || null,
      description: normalizeDisplayText(meta.description || ""),
      genres: Array.isArray(meta.genres)
        ? meta.genres.map((genre) => normalizeDisplayText(genre))
        : [],
      videos: Array.isArray(meta.videos) ? meta.videos : [],
      releaseInfo: normalizeDisplayText(meta.releaseInfo || ""),
      ageRating: firstNonBlank(
        appExtras.certificationLocal,
        appExtras.certification_local,
        appExtras.certification,
        meta.ageRating,
        meta.age_rating
      )
    };
  }

  clearCache() {
    this.metaCache.clear();
    this.inFlightMeta.clear();
    this.inFlightMetaAll.clear();
  }
}

export const metaRepository = new MetaRepository();
