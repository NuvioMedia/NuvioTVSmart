import { MemberCatalogStorage } from "../../local/memberCatalogStorage.js";
import { ServerConfigurationStore } from "../../local/serverConfigurationStore.js";
import { SupabaseApi } from "./supabaseApi.js";
import { createStorageAssetUrl, revokeStorageAssetUrl } from "./storageAsset.js";

const AVATAR_BUCKET = "avatars";
const MEMBER_AVATAR_BUCKET = "membership-profile-avatars";
const AVATAR_CATALOG_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

let cachedStandardCatalog = null;
let standardCatalogPromise = null;
let standardCatalogRefreshPromise = null;
let standardCatalogHydrated = false;
let lastStandardRefreshAtMs = 0;
let cachedMemberCatalog = null;
let memberCatalogPromise = null;
let memberCatalogRefreshPromise = null;
let memberCatalogHydrationPromise = null;
let memberCatalogHydrated = false;
let lastMemberRefreshAtMs = 0;
let memberCacheGeneration = 0;
const memberObjectUrls = new Set();

export function isAvatarCatalogRefreshDue(
  lastRefreshAtMs,
  nowMs = Date.now(),
  intervalMs = AVATAR_CATALOG_REFRESH_INTERVAL_MS
) {
  const last = Number(lastRefreshAtMs || 0);
  const now = Number(nowMs || 0);
  const interval = Math.max(0, Number(intervalMs) || 0);
  return last <= 0 || now < last || now - last >= interval;
}

function avatarImageUrl(storagePath = "") {
  const normalizedPath = String(storagePath || "")
    .trim()
    .replace(/^\/+/, "");
  if (!normalizedPath) {
    return null;
  }
  const configuration = ServerConfigurationStore.getActive();
  const configuredBaseUrl = String(configuration.avatarPublicBaseUrl || "")
    .trim()
    .replace(/\/+$/, "");
  if (configuredBaseUrl) {
    return `${configuredBaseUrl}/${normalizedPath}`;
  }
  return `${String(configuration.backendUrl || "").replace(/\/+$/, "")}/storage/v1/object/public/${AVATAR_BUCKET}/${normalizedPath}`;
}

function mapAvatar(row = {}) {
  return {
    id: String(row.id || ""),
    displayName: String(row.display_name || row.displayName || "Avatar"),
    imageUrl: avatarImageUrl(row.storage_path || row.storagePath || ""),
    category: String(row.category || "all")
      .trim()
      .toLowerCase(),
    sortOrder: Number(row.sort_order || row.sortOrder || 0),
    bgColor: row.bg_color || row.bgColor || null,
    memberOnly: Boolean(row.member_only || row.memberOnly)
  };
}

function mapMemberAvatar(row = {}) {
  return {
    id: String(row.id || ""),
    displayName: String(row.display_name || row.displayName || "Avatar"),
    imageUrl: null,
    category: String(row.category || "supporter")
      .trim()
      .toLowerCase(),
    sortOrder: Number(row.sort_order || row.sortOrder || 0),
    bgColor: row.bg_color || row.bgColor || null,
    storagePath: String(row.storage_path || row.storagePath || "").trim(),
    assetVersion: Number(row.asset_version || row.assetVersion || 1) || 1,
    memberOnly: true
  };
}

function storedCatalog() {
  return MemberCatalogStorage.loadAvatarCatalog();
}

function saveStoredCatalog(patch) {
  const previous = storedCatalog() || {};
  MemberCatalogStorage.saveAvatarCatalog({ ...previous, ...patch });
}

function hydrateStandardCatalog() {
  if (standardCatalogHydrated) {
    return;
  }
  standardCatalogHydrated = true;
  const stored = storedCatalog();
  if (stored?.standardLoaded !== true || !Array.isArray(stored.standardItems)) {
    return;
  }
  cachedStandardCatalog = stored.standardItems
    .map((row) => mapAvatar(row))
    .filter((avatar) => avatar.id && avatar.imageUrl);
}

function hasStoredMemberCatalog() {
  const stored = storedCatalog();
  return stored?.memberLoaded === true && Array.isArray(stored.memberItems);
}

async function loadMemberAvatarAsset(avatar, generation = memberCacheGeneration) {
  if (!avatar?.id || !avatar.storagePath || avatar.imageUrl) {
    return avatar;
  }
  try {
    let blob = await MemberCatalogStorage.loadAsset("avatar", avatar.id, avatar.assetVersion);
    if (!blob) {
      blob = await SupabaseApi.downloadStorageObject(
        MEMBER_AVATAR_BUCKET,
        avatar.storagePath,
        true
      );
      if (blob) {
        await MemberCatalogStorage.saveAsset("avatar", avatar.id, avatar.assetVersion, blob);
      }
    }
    const imageUrl = await createStorageAssetUrl(blob);
    if (!imageUrl) {
      return null;
    }
    if (generation !== memberCacheGeneration) {
      revokeStorageAssetUrl(imageUrl);
      return null;
    }
    memberObjectUrls.add(imageUrl);
    return { ...avatar, imageUrl };
  } catch (error) {
    console.warn(`Unable to load supporter avatar ${avatar.id}`, error);
    return null;
  }
}

async function hydrateStoredMemberCatalog() {
  if (memberCatalogHydrationPromise) {
    return memberCatalogHydrationPromise;
  }
  if (memberCatalogHydrated) {
    return;
  }
  const generation = memberCacheGeneration;
  let requestPromise;
  requestPromise = (async () => {
    const stored = storedCatalog();
    memberCatalogHydrated = true;
    if (stored?.memberLoaded !== true || !Array.isArray(stored.memberItems)) {
      return;
    }
    const entries = stored.memberItems
      .map((row) => mapMemberAvatar(row))
      .filter((avatar) => avatar.id && avatar.storagePath);
    const loaded = await Promise.all(
      entries.map((avatar) => loadMemberAvatarAsset(avatar, generation))
    );
    if (generation === memberCacheGeneration) {
      cachedMemberCatalog = loaded.filter(Boolean);
    }
  })().finally(() => {
    if (memberCatalogHydrationPromise === requestPromise) {
      memberCatalogHydrationPromise = null;
    }
  });
  memberCatalogHydrationPromise = requestPromise;
  return requestPromise;
}

async function fetchStandardAvatarCatalog() {
  const response = await SupabaseApi.rpc("get_avatar_catalog", {}, false);
  const rows = Array.isArray(response) ? response : [];
  cachedStandardCatalog = rows
    .map((row) => mapAvatar(row))
    .filter((avatar) => avatar.id && avatar.imageUrl);
  lastStandardRefreshAtMs = Date.now();
  saveStoredCatalog({ standardItems: rows, standardLoaded: true });
  return cachedStandardCatalog;
}

async function loadStandardCatalog() {
  hydrateStandardCatalog();
  if (Array.isArray(cachedStandardCatalog)) {
    return cachedStandardCatalog;
  }
  if (standardCatalogPromise) {
    return standardCatalogPromise;
  }
  let requestPromise;
  requestPromise = fetchStandardAvatarCatalog().finally(() => {
    if (standardCatalogPromise === requestPromise) {
      standardCatalogPromise = null;
    }
  });
  standardCatalogPromise = requestPromise;
  return requestPromise;
}

function refreshStandardCatalogInBackground() {
  if (
    standardCatalogRefreshPromise ||
    standardCatalogPromise ||
    !isAvatarCatalogRefreshDue(lastStandardRefreshAtMs)
  ) {
    return;
  }
  let requestPromise;
  requestPromise = fetchStandardAvatarCatalog()
    .catch((error) => {
      console.warn("Unable to refresh avatar catalog", error);
      return cachedStandardCatalog || [];
    })
    .finally(() => {
      if (standardCatalogRefreshPromise === requestPromise) {
        standardCatalogRefreshPromise = null;
      }
    });
  standardCatalogRefreshPromise = requestPromise;
}

async function fetchMemberAvatarCatalog() {
  const generation = memberCacheGeneration;
  try {
    const response = await SupabaseApi.rpc("get_member_profile_avatar_catalog", {}, true);
    const entries = (Array.isArray(response) ? response : [])
      .map((row) => mapMemberAvatar(row))
      .filter((avatar) => avatar.id && avatar.storagePath);
    saveStoredCatalog({ memberItems: response, memberLoaded: true });
    const loaded = await Promise.all(
      entries.map((avatar) => loadMemberAvatarAsset(avatar, generation))
    );
    if (generation !== memberCacheGeneration) {
      return [];
    }
    cachedMemberCatalog = loaded.filter(Boolean);
    lastMemberRefreshAtMs = Date.now();
    memberCatalogHydrated = true;
    return cachedMemberCatalog;
  } catch (error) {
    if (generation !== memberCacheGeneration) {
      return [];
    }
    console.warn("Unable to load supporter avatar catalog", error);
    if (!Array.isArray(cachedMemberCatalog)) {
      cachedMemberCatalog = [];
    }
    return cachedMemberCatalog;
  }
}

async function loadMemberCatalog() {
  if (Array.isArray(cachedMemberCatalog)) {
    return cachedMemberCatalog;
  }
  if (memberCatalogPromise) {
    return memberCatalogPromise;
  }
  let requestPromise;
  requestPromise = (async () => {
    await hydrateStoredMemberCatalog();
    if (Array.isArray(cachedMemberCatalog)) {
      return cachedMemberCatalog;
    }
    return fetchMemberAvatarCatalog();
  })().finally(() => {
    if (memberCatalogPromise === requestPromise) {
      memberCatalogPromise = null;
    }
  });
  memberCatalogPromise = requestPromise;
  return requestPromise;
}

function refreshMemberCatalogInBackground() {
  if (
    memberCatalogRefreshPromise ||
    memberCatalogPromise ||
    !isAvatarCatalogRefreshDue(lastMemberRefreshAtMs)
  ) {
    return;
  }
  let requestPromise;
  requestPromise = fetchMemberAvatarCatalog().finally(() => {
    if (memberCatalogRefreshPromise === requestPromise) {
      memberCatalogRefreshPromise = null;
    }
  });
  memberCatalogRefreshPromise = requestPromise;
}

export const AvatarRepository = {
  getCachedAvatarCatalog(hasMemberAccess = false) {
    hydrateStandardCatalog();
    const standardCatalog = Array.isArray(cachedStandardCatalog) ? cachedStandardCatalog : [];
    if (!hasMemberAccess) {
      return standardCatalog;
    }
    const memberCatalog = Array.isArray(cachedMemberCatalog) ? cachedMemberCatalog : [];
    return [...standardCatalog, ...memberCatalog];
  },

  async getAvatarCatalog(hasMemberAccess = false) {
    hydrateStandardCatalog();
    const hadStandardCache = Array.isArray(cachedStandardCatalog);
    const standardCatalog = await loadStandardCatalog();
    if (hadStandardCache) {
      refreshStandardCatalogInBackground();
    }

    if (!hasMemberAccess) {
      return standardCatalog;
    }

    const hadMemberCache = Array.isArray(cachedMemberCatalog) || hasStoredMemberCatalog();
    const memberCatalog = await loadMemberCatalog();
    if (hadMemberCache) {
      refreshMemberCatalogInBackground();
    }
    return [...standardCatalog, ...memberCatalog];
  },

  getAvatarImageUrl(avatarId, catalog = cachedStandardCatalog || []) {
    const normalizedId = String(avatarId || "").trim();
    if (!normalizedId) {
      return null;
    }
    const entries = [
      ...(Array.isArray(catalog) ? catalog : []),
      ...(Array.isArray(cachedMemberCatalog) ? cachedMemberCatalog : [])
    ];
    return entries.find((avatar) => avatar.id === normalizedId)?.imageUrl || null;
  },

  invalidateCache() {
    cachedStandardCatalog = null;
    standardCatalogPromise = null;
    standardCatalogRefreshPromise = null;
    standardCatalogHydrated = false;
    lastStandardRefreshAtMs = 0;
    cachedMemberCatalog = null;
    memberCatalogPromise = null;
    memberCatalogRefreshPromise = null;
    memberCatalogHydrationPromise = null;
    memberCatalogHydrated = false;
    lastMemberRefreshAtMs = 0;
    memberCacheGeneration += 1;
    memberObjectUrls.forEach((url) => revokeStorageAssetUrl(url));
    memberObjectUrls.clear();
  }
};
