import { LocalStore } from "../storage/localStore.js";
import { Environment } from "../../platform/environment.js";
import { Platform } from "../../platform/index.js";
import { isWebOsImageProxyUrl, normalizeImageUrl } from "./imageProxy.js";

const failedAddonLogoUrls = new Set();
const addonLogoCache = new Map();
const ADDON_LOGO_CACHE_KEY = "nuvio.stream.addonLogoCache.v1";
const ADDON_LOGO_CACHE_LIMIT = 36;
const ADDON_LOGO_TV_CACHE_LIMIT = 12;
const ADDON_LOGO_CACHE_MAX_LENGTH = 140000;
const ADDON_LOGO_PRELOAD_CONCURRENCY_TV = 3;
const ADDON_LOGO_PRELOAD_CONCURRENCY_DEFAULT = 6;

let addonLogoCacheHydrated = false;
let addonLogoCachePersistTimer = null;

export function normalizeAddonLogoUrl(value = "") {
  return normalizeImageUrl(value);
}

export function resetAddonLogoCache() {
  failedAddonLogoUrls.clear();
  addonLogoCache.clear();
  addonLogoCacheHydrated = false;
  if (addonLogoCachePersistTimer) {
    clearTimeout(addonLogoCachePersistTimer);
    addonLogoCachePersistTimer = null;
  }
  LocalStore.remove(ADDON_LOGO_CACHE_KEY);
}

export async function warmAddonLogoPreview(url = "") {
  const normalized = normalizeAddonLogoUrl(url);
  if (!normalized || failedAddonLogoUrls.has(normalized)) {
    return false;
  }
  hydrateAddonLogoCache();
  const cached = addonLogoCache.get(normalized);
  if (cached?.status === "ready" || cached?.status === "direct") {
    return true;
  }
  if (cached?.status === "loading") {
    return cached.promise || Promise.resolve(false);
  }

  const loadingEntry = { status: "loading", updatedAt: Date.now(), promise: null };
  addonLogoCache.set(normalized, loadingEntry);
  const promise = new Promise((resolve) => {
    const settle = (ok) => resolve(ok);
    const fail = () => {
      failedAddonLogoUrls.add(normalized);
      addonLogoCache.set(normalized, { status: "failed", updatedAt: Date.now() });
      settle(false);
    };
    const finishDirect = () => {
      addonLogoCache.set(normalized, {
        status: "direct",
        displayUrl: normalized,
        updatedAt: Date.now()
      });
      settle(true);
    };
    const loadDirect = () => {
      const directImage = new Image();
      directImage.decoding = "async";
      try {
        directImage.referrerPolicy = "no-referrer";
      } catch (_) {}
      directImage.onload = () => {
        (async () => {
          await awaitImageDecoded(directImage);
          finishDirect();
        })();
      };
      directImage.onerror = fail;
      directImage.src = normalized;
    };
    const finish = (image = null) => {
      if (image && typeof imageToDataUrl === "function") {
        (async () => {
          try {
            if (!(await awaitImageDecoded(image))) {
              throw new Error("decode-failed");
            }
            const dataUrl = imageToDataUrl(image);
            if (dataUrl) {
              addonLogoCache.set(normalized, {
                status: "ready",
                displayUrl: dataUrl,
                updatedAt: Date.now()
              });
              scheduleAddonLogoCachePersist();
              settle(true);
              return;
            }
          } catch (_) {}
          finishDirect();
        })();
        return;
      }
      finishDirect();
    };
    const image = new Image();
    image.decoding = "async";
    try {
      image.crossOrigin = "anonymous";
    } catch (_) {}
    try {
      image.referrerPolicy = "no-referrer";
    } catch (_) {}
    image.onload = () => finish(image);
    image.onerror = loadDirect;
    image.src = normalized;
  });
  loadingEntry.promise = promise;
  return promise;
}

export async function preloadAddonLogoImages(streams = [], lookup = {}) {
  const urls = new Set();
  (streams || []).forEach((stream) => {
    const url = normalizeAddonLogoUrl(
      stream?.addonLogo || stream?.raw?.addonLogo || resolveAddonLogo(stream?.addonName, lookup)
    );
    if (url) {
      urls.add(url);
    }
  });
  await preloadAddonLogoUrls(urls);
}

export async function preloadAddonLogoUrls(urls = []) {
  const pending = Array.from(
    new Set(
      Array.from(urls || [])
        .map(normalizeAddonLogoUrl)
        .filter(Boolean)
    )
  );
  if (!pending.length) {
    return;
  }

  const concurrency =
    Environment.isWebOS() || Platform.isTizen()
      ? ADDON_LOGO_PRELOAD_CONCURRENCY_TV
      : ADDON_LOGO_PRELOAD_CONCURRENCY_DEFAULT;
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < pending.length) {
      const url = pending[nextIndex];
      nextIndex += 1;
      await warmAddonLogoPreview(url);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, () => worker()));
}

export function requestAddonLogo(url = "", onSettled = null) {
  const normalized = normalizeAddonLogoUrl(url);
  if (!normalized || failedAddonLogoUrls.has(normalized)) {
    return Promise.resolve(false);
  }
  hydrateAddonLogoCache();
  const cached = addonLogoCache.get(normalized);
  if (cached?.status === "ready" || cached?.status === "direct") {
    return Promise.resolve(true);
  }
  if (cached?.status === "loading") {
    return cached.promise || Promise.resolve(false);
  }

  if ((Environment.isWebOS() || Platform.isTizen()) && !isWebOsImageProxyUrl(normalized)) {
    addonLogoCache.set(normalized, {
      status: "direct",
      displayUrl: normalized,
      updatedAt: Date.now()
    });
    if (typeof onSettled === "function") {
      setTimeout(onSettled, 0);
    }
    return Promise.resolve(true);
  }

  const loadingEntry = { status: "loading", updatedAt: Date.now(), promise: null };
  addonLogoCache.set(normalized, loadingEntry);
  const promise = new Promise((resolve) => {
    const settle = (ok) => {
      if (typeof onSettled === "function") {
        onSettled();
      }
      resolve(ok);
    };
    const fail = () => {
      failedAddonLogoUrls.add(normalized);
      addonLogoCache.set(normalized, { status: "failed", updatedAt: Date.now() });
      settle(false);
    };
    const finishDirect = () => {
      addonLogoCache.set(normalized, {
        status: "direct",
        displayUrl: normalized,
        updatedAt: Date.now()
      });
      settle(true);
    };
    const loadDirect = () => {
      const directImage = new Image();
      directImage.decoding = "async";
      try {
        directImage.referrerPolicy = "no-referrer";
      } catch (_) {}
      directImage.onload = () => {
        (async () => {
          await awaitImageDecoded(directImage);
          finishDirect();
        })();
      };
      directImage.onerror = fail;
      directImage.src = normalized;
    };
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    try {
      image.referrerPolicy = "no-referrer";
    } catch (_) {}
    image.onload = () => {
      (async () => {
        try {
          if (!(await awaitImageDecoded(image))) {
            throw new Error("decode-failed");
          }
          const dataUrl = imageToDataUrl(image);
          addonLogoCache.set(normalized, {
            status: "ready",
            displayUrl: dataUrl,
            updatedAt: Date.now()
          });
          scheduleAddonLogoCachePersist();
          settle(true);
        } catch (_) {
          loadDirect();
        }
      })();
    };
    image.onerror = loadDirect;
    image.src = normalized;
  });
  loadingEntry.promise = promise;
  return promise;
}

export function getCachedAddonLogoDisplayUrl(url = "") {
  const normalized = normalizeAddonLogoUrl(url);
  if (!normalized || failedAddonLogoUrls.has(normalized)) {
    return "";
  }
  hydrateAddonLogoCache();
  const cached = addonLogoCache.get(normalized);
  return cached?.status === "ready" || cached?.status === "direct"
    ? String(cached.displayUrl || "")
    : "";
}

export function normalizeAddonLookupKey(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function rememberAddonLogoLookup(lookup = {}, addonName = "", addonLogo = "") {
  const key = normalizeAddonLookupKey(addonName);
  const rawLogo = String(addonLogo || "").trim();
  const logo = normalizeAddonLogoUrl(rawLogo) || rawLogo;
  if (key && logo) {
    lookup[key] = logo;
  }
}

export function normalizeAddonLogoLookup(lookup = {}) {
  const normalized = {};
  Object.entries(lookup || {}).forEach(([key, value]) => {
    rememberAddonLogoLookup(normalized, key, value);
  });
  return normalized;
}

export function resolveAddonLogo(addonName = "", lookup = {}) {
  const key = normalizeAddonLookupKey(addonName);
  return key ? normalizeAddonLogoUrl(lookup?.[key]) : "";
}

export function rememberFailedAddonLogo(url = "") {
  const normalized = normalizeAddonLogoUrl(url);
  if (normalized) {
    failedAddonLogoUrls.add(normalized);
  }
}

export function clearFailedAddonLogos() {
  failedAddonLogoUrls.clear();
}

export function hasFailedAddonLogo(url = "") {
  const normalized = normalizeAddonLogoUrl(url);
  return Boolean(normalized && failedAddonLogoUrls.has(normalized));
}

function hydrateAddonLogoCache() {
  if (addonLogoCacheHydrated) {
    return;
  }
  addonLogoCacheHydrated = true;
  if (Platform.isTizen()) {
    return;
  }
  const cached = LocalStore.get(ADDON_LOGO_CACHE_KEY, {});
  const entries = cached && typeof cached === "object" && !Array.isArray(cached) ? cached : {};
  Object.keys(entries).forEach((url) => {
    const entry = entries[url];
    const dataUrl = String(entry?.dataUrl || "").trim();
    if (!url || !dataUrl.startsWith("data:image/")) {
      return;
    }
    addonLogoCache.set(url, {
      status: "ready",
      displayUrl: dataUrl,
      updatedAt: Number(entry?.updatedAt || Date.now())
    });
  });
}

function persistAddonLogoCache() {
  if (Platform.isTizen()) {
    return;
  }
  addonLogoCachePersistTimer = null;
  const cacheLimit = Platform.isWebOS() ? ADDON_LOGO_TV_CACHE_LIMIT : ADDON_LOGO_CACHE_LIMIT;
  const entries = Array.from(addonLogoCache.entries())
    .filter(
      ([, entry]) =>
        entry?.status === "ready" &&
        String(entry.displayUrl || "").startsWith("data:image/") &&
        String(entry.displayUrl || "").length <= ADDON_LOGO_CACHE_MAX_LENGTH
    )
    .sort((left, right) => Number(right[1].updatedAt || 0) - Number(left[1].updatedAt || 0))
    .slice(0, cacheLimit);
  const payload = {};
  entries.forEach(([url, entry]) => {
    payload[url] = {
      dataUrl: entry.displayUrl,
      updatedAt: Number(entry.updatedAt || Date.now())
    };
  });
  LocalStore.set(ADDON_LOGO_CACHE_KEY, payload);
}

function scheduleAddonLogoCachePersist() {
  if (Platform.isTizen()) {
    return;
  }
  if (addonLogoCachePersistTimer) {
    return;
  }
  addonLogoCachePersistTimer = setTimeout(persistAddonLogoCache, 800);
}

function imageToDataUrl(image) {
  const naturalWidth = Math.max(1, Number(image?.naturalWidth || image?.width || 1));
  const naturalHeight = Math.max(1, Number(image?.naturalHeight || image?.height || 1));
  const maxSize = 144;
  const ratio = Math.min(1, maxSize / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(1, Math.round(naturalWidth * ratio));
  const height = Math.max(1, Math.round(naturalHeight * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas unavailable");
  }
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/png");
}

async function awaitImageDecoded(image) {
  if (!image || typeof image.decode !== "function") {
    return true;
  }
  try {
    await image.decode();
    return true;
  } catch (_) {
    return false;
  }
}
