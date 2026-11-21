import { MemberCatalogStorage } from "../../local/memberCatalogStorage.js";
import { SupabaseApi } from "./supabaseApi.js";
import { createStorageAssetUrl, revokeStorageAssetUrl } from "./storageAsset.js";

const PROFILE_BACKGROUND_BUCKET = "membership-profile-backgrounds";

let remoteCatalog = null;
let catalogLoadPromise = null;
let cacheGeneration = 0;
let catalogHydrated = false;
let remoteCatalogLoaded = false;
const assetPromises = new Map();
const objectUrls = new Set();
const listeners = new Set();

function mapBackground(row = {}) {
  return {
    id: String(row.id || "").trim(),
    displayName: String(row.display_name || row.displayName || row.name || "Background"),
    storagePath: String(row.storage_path || row.storagePath || "").trim(),
    portraitStoragePath: String(row.portrait_storage_path || row.portraitStoragePath || "").trim(),
    assetVersion: Number(row.asset_version || row.assetVersion || 1) || 1,
    imageUrl: null
  };
}

function hydrateStoredCatalog() {
  if (catalogHydrated) {
    return;
  }
  catalogHydrated = true;
  const stored = MemberCatalogStorage.loadProfileBackgroundCatalog();
  if (!Array.isArray(stored?.items)) {
    return;
  }
  remoteCatalog = stored.items
    .map((row) => mapBackground(row))
    .filter((item) => item.id && item.storagePath);
}

function notify() {
  const catalog = remoteCatalog || [];
  listeners.forEach((listener) => {
    try {
      listener(catalog);
    } catch (error) {
      console.warn("Profile background listener failed", error);
    }
  });
}

function assetKey(item) {
  return `${item.id}:v${item.assetVersion}`;
}

async function loadAndPublish(item) {
  if (!item?.id || item.imageUrl) {
    return item?.imageUrl || null;
  }
  const key = assetKey(item);
  if (assetPromises.has(key)) {
    return assetPromises.get(key);
  }
  const generation = cacheGeneration;
  let promise;
  promise = (async () => {
    try {
      let blob = await MemberCatalogStorage.loadAsset(
        "profile-background",
        item.id,
        item.assetVersion
      );
      if (!blob) {
        blob = await SupabaseApi.downloadStorageObject(
          PROFILE_BACKGROUND_BUCKET,
          item.storagePath,
          true
        );
        if (blob) {
          if (generation !== cacheGeneration) {
            return null;
          }
          await MemberCatalogStorage.saveAsset(
            "profile-background",
            item.id,
            item.assetVersion,
            blob,
            { shouldSave: () => generation === cacheGeneration }
          );
        }
      }
      if (generation !== cacheGeneration) {
        return null;
      }
      const imageUrl = await createStorageAssetUrl(blob);
      if (!imageUrl) {
        return null;
      }
      if (generation !== cacheGeneration) {
        revokeStorageAssetUrl(imageUrl);
        return null;
      }
      objectUrls.add(imageUrl);
      if (remoteCatalog) {
        const target = remoteCatalog.find(
          (entry) => entry.id === item.id && entry.assetVersion === item.assetVersion
        );
        if (target) {
          target.imageUrl = imageUrl;
          notify();
        }
      }
      return imageUrl;
    } catch (error) {
      console.warn(`Unable to load supporter profile background ${item.id}`, error);
      return null;
    } finally {
      if (assetPromises.get(key) === promise) {
        assetPromises.delete(key);
      }
    }
  })();
  assetPromises.set(key, promise);
  return promise;
}

function startCatalogLoad() {
  if (catalogLoadPromise || remoteCatalogLoaded) {
    return catalogLoadPromise;
  }
  const generation = cacheGeneration;
  let requestPromise;
  requestPromise = (async () => {
    try {
      const response = await SupabaseApi.rpc("get_member_profile_background_catalog", {}, true);
      if (generation !== cacheGeneration) {
        return remoteCatalog || [];
      }
      const rows = Array.isArray(response) ? response : [];
      const previousByAssetKey = new Map();
      (remoteCatalog || []).forEach((item) => {
        if (item?.imageUrl) {
          previousByAssetKey.set(assetKey(item), item.imageUrl);
        }
      });
      const nextCatalog = rows
        .map((row) => mapBackground(row))
        .filter((item) => item.id && item.storagePath)
        .map((item) => {
          const existingUrl = previousByAssetKey.get(assetKey(item));
          return existingUrl ? { ...item, imageUrl: existingUrl } : item;
        });
      const activeUrls = new Set(nextCatalog.map((item) => item.imageUrl).filter(Boolean));
      previousByAssetKey.forEach((url) => {
        if (!activeUrls.has(url)) {
          objectUrls.delete(url);
          revokeStorageAssetUrl(url);
        }
      });
      remoteCatalog = nextCatalog;
      remoteCatalogLoaded = true;
      MemberCatalogStorage.saveProfileBackgroundCatalog({ items: rows });
      notify();
      return remoteCatalog;
    } catch (error) {
      if (generation !== cacheGeneration) {
        return [];
      }
      console.warn("Unable to load supporter profile background catalog", error);
      if (!Array.isArray(remoteCatalog)) {
        remoteCatalog = [];
      }
      notify();
      return remoteCatalog;
    } finally {
      if (catalogLoadPromise === requestPromise) {
        catalogLoadPromise = null;
      }
    }
  })();
  catalogLoadPromise = requestPromise;
  return requestPromise;
}

async function preloadCatalog(catalog, selectedId = null) {
  const selected = catalog.find((item) => item.id === String(selectedId || "").trim());
  if (selected) {
    await loadAndPublish(selected);
  }
  await Promise.all(
    catalog.filter((item) => item !== selected).map((item) => loadAndPublish(item))
  );
}

export const ProfileBackgroundRepository = {
  async ensureLoaded() {
    hydrateStoredCatalog();
    const hadCatalog = Array.isArray(remoteCatalog);
    const pendingCatalogLoad = startCatalogLoad();
    if (!hadCatalog && pendingCatalogLoad) {
      await pendingCatalogLoad;
    }
    return remoteCatalog || [];
  },

  getCatalog() {
    hydrateStoredCatalog();
    return Array.isArray(remoteCatalog) ? remoteCatalog : [];
  },

  getImageUrl(id) {
    const normalizedId = String(id || "").trim();
    if (!normalizedId) {
      return null;
    }
    return this.getCatalog().find((item) => item.id === normalizedId)?.imageUrl || null;
  },

  async loadSelectedAndPreload(selectedId = null) {
    const catalog = await this.ensureLoaded();
    const pendingCatalogLoad = catalogLoadPromise;
    await preloadCatalog(catalog, selectedId);
    if (pendingCatalogLoad) {
      await pendingCatalogLoad;
    }
    const latestCatalog = this.getCatalog();
    if (latestCatalog !== catalog) {
      await preloadCatalog(latestCatalog, selectedId);
    }
    return this.getCatalog();
  },

  preloadImages() {
    return this.loadSelectedAndPreload(null);
  },

  subscribe(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    listeners.add(listener);
    listener(this.getCatalog());
    return () => listeners.delete(listener);
  },

  invalidateCache() {
    cacheGeneration += 1;
    assetPromises.clear();
    objectUrls.forEach((url) => revokeStorageAssetUrl(url));
    objectUrls.clear();
    remoteCatalog = null;
    catalogLoadPromise = null;
    catalogHydrated = false;
    remoteCatalogLoaded = false;
    notify();
  }
};
