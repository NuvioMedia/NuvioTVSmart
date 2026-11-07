import { metaRepository } from "./metaRepository.js";
import { registerSessionTeardownHandler } from "../../core/auth/sessionLifecycle.js";
import { mapWithConcurrency } from "../../core/network/mapWithConcurrency.js";
import { episodeMappingEntries } from "../../core/tracking/episodeMapping.js";

// Episode lists as the installed add-ons number them, shared by the Trakt and MDBList
// remapping services. Ported from Android AddonEpisodeListService (cache + in-flight dedupe).

const META_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;
const PREFETCH_CONCURRENCY = 8;

const cache = new Map();
const inFlight = new Map();

function normalizeContentType(value) {
  const type = String(value || "")
    .trim()
    .toLowerCase();
  return type || "series";
}

function cacheKey(contentId, contentType) {
  const id = String(contentId || "").trim();
  return id ? `${normalizeContentType(contentType)}|${id}` : "";
}

function withTimeout(promise, ms, fallbackValue) {
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallbackValue), Math.max(0, Number(ms) || 0));
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function candidateIds(contentId) {
  const raw = String(contentId || "").trim();
  if (!raw) {
    return [];
  }
  const unwrapped = raw.replace(/^(imdb|tmdb|trakt|tvdb):/i, "").trim();
  return [...new Set([raw, unwrapped].filter(Boolean))];
}

function candidateTypes(contentType) {
  const type = normalizeContentType(contentType);
  if (["series", "tv"].includes(type)) {
    return ["series", "tv"];
  }
  return [type];
}

async function fetchSeriesMeta(contentId, contentType) {
  for (const type of candidateTypes(contentType)) {
    for (const id of candidateIds(contentId)) {
      const result = await withTimeout(
        metaRepository.getMetaFromAllAddons(type, id),
        META_TIMEOUT_MS,
        null
      );
      const meta = result?.status === "success" ? result.data : null;
      if (meta?.videos?.some((video) => video?.season != null && video?.episode != null)) {
        return meta;
      }
    }
  }
  return null;
}

function remember(key, entries) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, { entries, expiresAt: Date.now() + CACHE_TTL_MS });
}

function rememberEmpty(key) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
  // Negative results expire sooner so a transient add-on failure does not hide
  // remapping for a whole session.
  cache.set(key, { entries: [], expiresAt: Date.now() + 2 * 60 * 1000 });
}

export const addonEpisodeListRepository = {
  async episodes(contentId, contentType = "series") {
    const key = cacheKey(contentId, contentType);
    if (!key) {
      return [];
    }
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.entries;
    }
    const pending = inFlight.get(key);
    if (pending) {
      return pending;
    }
    const request = (async () => {
      try {
        const meta = await fetchSeriesMeta(contentId, contentType);
        const entries = episodeMappingEntries(meta?.videos || []);
        if (entries.length) {
          remember(key, entries);
        } else {
          rememberEmpty(key);
        }
        return entries;
      } catch (_) {
        rememberEmpty(key);
        return [];
      }
    })().finally(() => {
      if (inFlight.get(key) === request) {
        inFlight.delete(key);
      }
    });
    inFlight.set(key, request);
    return request;
  },

  /** Warms the cache for a batch of shows, bounded like Android's prefetch. */
  async prefetch(contentIds = [], concurrency = PREFETCH_CONCURRENCY) {
    const unique = [
      ...new Set(
        (Array.isArray(contentIds) ? contentIds : [])
          .map((id) => String(id || "").trim())
          .filter(Boolean)
      )
    ];
    if (!unique.length) {
      return;
    }
    const limit = Math.max(1, Math.trunc(Number(concurrency) || PREFETCH_CONCURRENCY));
    await mapWithConcurrency(unique, limit, (contentId) =>
      this.episodes(contentId, "series").catch(() => [])
    );
  },

  clearCache() {
    cache.clear();
    inFlight.clear();
  }
};

registerSessionTeardownHandler(() => addonEpisodeListRepository.clearCache());
