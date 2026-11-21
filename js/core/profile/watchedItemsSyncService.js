import { AuthManager } from "../auth/authManager.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { watchedItemsRepository } from "../../data/repository/watchedItemsRepository.js";
import { ProfileManager } from "./profileManager.js";
import { LocalStore } from "../storage/localStore.js";
import { TraktAuthStore } from "../../data/local/traktAuthStore.js";
import { MdbListAccount } from "../../data/repository/mdbListAccount.js";
import { SimklAuthStore } from "../../data/local/simklAuthStore.js";
import { TraktSettingsStore, WatchProgressSource } from "../../data/local/traktSettingsStore.js";
import { isSyncBackoffActive } from "../sync/syncBackoffPolicy.js";
import { isDeviceLocalWatchId } from "./syncLocalIds.js";

const PULL_RPC = "sync_pull_watched_items";
const PUSH_RPC = "sync_push_watched_items";
const DELETE_RPC = "sync_delete_watched_items";
const SYNC_STATE_KEY = "watchedItemsSyncState";
const WATCHED_ITEMS_PAGE_SIZE = 900;

let lastPullStatus = "idle";
let lastPullHadUnsynced = false;
let lastPullChangedHomeInputs = false;
let homeInputChangeRevision = 0;

function resolveProfileId(profileId = null) {
  const raw = Number(profileId ?? ProfileManager.getActiveProfileId() ?? 1);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 1;
}

function shouldUseSupabaseWatchProgressSync() {
  const source = TraktSettingsStore.get().watchProgressSource || WatchProgressSource.TRAKT;
  const providerSelected =
    (TraktAuthStore.isAuthenticated() && source === WatchProgressSource.TRAKT) ||
    (SimklAuthStore.isAuthenticated() && source === WatchProgressSource.SIMKL) ||
    (MdbListAccount.connected() && source === WatchProgressSource.MDBLIST);
  return !providerSelected;
}

function mapRemoteItem(row = {}) {
  const watchedAtRaw = row.watched_at || row.watchedAt || null;
  const numeric = Number(watchedAtRaw);
  const parsedDate = Number.isFinite(numeric) ? numeric : new Date(watchedAtRaw).getTime();
  return {
    contentId: row.content_id || row.contentId || "",
    contentType: row.content_type || row.contentType || "movie",
    title: row.title || row.name || "",
    season: row.season == null ? null : Number(row.season),
    episode: row.episode == null ? null : Number(row.episode),
    watchedAt: Number.isFinite(parsedDate) ? parsedDate : Date.now()
  };
}

function watchedItemKey(item = {}) {
  const contentId = String(item.contentId || "").trim();
  const season = item.season == null ? "" : String(Number(item.season));
  const episode = item.episode == null ? "" : String(Number(item.episode));
  return `${contentId}:${season}:${episode}`;
}

function homeWatchedItemsSnapshotSignature(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => Boolean(item?.contentId))
    .map((item) =>
      JSON.stringify([
        watchedItemKey(item),
        String(item.contentType || "movie"),
        String(item.title || ""),
        item.season == null ? null : Number(item.season),
        item.episode == null ? null : Number(item.episode),
        Number(item.watchedAt || 0)
      ])
    )
    .sort()
    .join("\n");
}

function watchedStateForProfile(profileId = resolveProfileId()) {
  const state = LocalStore.get(SYNC_STATE_KEY, {});
  const profileState = state && typeof state === "object" ? state[String(profileId)] : null;
  return profileState && typeof profileState === "object" ? profileState : {};
}

function writeWatchedStateForProfile(profileId = resolveProfileId(), patch = {}) {
  const state = LocalStore.get(SYNC_STATE_KEY, {});
  const next = state && typeof state === "object" ? state : {};
  next[String(profileId)] = {
    ...(next[String(profileId)] || {}),
    ...patch,
    updatedAt: Date.now()
  };
  LocalStore.set(SYNC_STATE_KEY, next);
}

export function mergeWatchedItems(localItems = [], remoteItems = [], lastSuccessfulPushAt = 0) {
  if (!remoteItems.length) {
    return [...localItems];
  }
  const byKey = new Map();
  const upsert = (item, preferIncomingOnTie = false) => {
    const key = watchedItemKey(item);
    if (key.startsWith(":")) {
      return;
    }
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      return;
    }
    const existingWatchedAt = Number(existing.watchedAt || 0);
    const incomingWatchedAt = Number(item.watchedAt || 0);
    if (
      incomingWatchedAt > existingWatchedAt ||
      (incomingWatchedAt === existingWatchedAt && preferIncomingOnTie)
    ) {
      byKey.set(key, item);
    }
  };

  remoteItems.forEach((item) => upsert(item, true));
  // Media-server watched state is device-local (Android keeps it out of the
  // cloud snapshot), so it must survive a pull that never contains it.
  localItems.forEach((item) => {
    if (!isDeviceLocalWatchId(item.contentId)) {
      return;
    }
    const key = watchedItemKey(item);
    if (!key.startsWith(":")) {
      byKey.set(key, item);
    }
  });
  if (lastSuccessfulPushAt > 0) {
    localItems.forEach((item) => {
      if (isDeviceLocalWatchId(item.contentId)) {
        return;
      }
      const key = watchedItemKey(item);
      if (!byKey.has(key) && Number(item.watchedAt || 0) > lastSuccessfulPushAt) {
        byKey.set(key, item);
      }
    });
  }
  return Array.from(byKey.values()).sort(
    (left, right) => Number(right.watchedAt || 0) - Number(left.watchedAt || 0)
  );
}

function hasUnsyncedLocalItems(localItems = [], remoteItems = [], lastSuccessfulPushAt = 0) {
  const remoteByKey = new Map(remoteItems.map((item) => [watchedItemKey(item), item]));
  return localItems.some((item) => {
    if (isDeviceLocalWatchId(item.contentId)) {
      return false;
    }
    const watchedAt = Number(item.watchedAt || 0);
    if (watchedAt <= Number(lastSuccessfulPushAt || 0)) {
      return false;
    }
    const remote = remoteByKey.get(watchedItemKey(item));
    return !remote || watchedAt > Number(remote.watchedAt || 0);
  });
}

function toRemoteItem(item = {}) {
  return {
    content_id: item.contentId,
    content_type: item.contentType || "movie",
    title: item.title || "",
    season: item.season == null ? null : Number(item.season),
    episode: item.episode == null ? null : Number(item.episode),
    watched_at: Number(item.watchedAt || Date.now())
  };
}

function toDeleteKey(item = {}) {
  const key = {
    content_id: item.contentId
  };
  if (item.season != null) {
    key.season = Number(item.season);
  }
  if (item.episode != null) {
    key.episode = Number(item.episode);
  }
  return key;
}

async function pullRemoteWatchedItems(profileId) {
  const allRows = [];
  let page = 1;
  while (true) {
    const rows = await SupabaseApi.rpc(
      PULL_RPC,
      {
        p_profile_id: profileId,
        p_page: page,
        p_page_size: WATCHED_ITEMS_PAGE_SIZE
      },
      true
    );
    if (!Array.isArray(rows)) {
      const error = new Error("Watched items sync returned an invalid page");
      error.code = "INVALID_SYNC_PAGE";
      throw error;
    }
    const pageRows = rows;
    allRows.push(...pageRows);
    if (pageRows.length < WATCHED_ITEMS_PAGE_SIZE) {
      return allRows;
    }
    page += 1;
  }
}

export const WatchedItemsSyncService = {
  getLastPullStatus() {
    return lastPullStatus;
  },

  getLastPullHadUnsynced() {
    return lastPullHadUnsynced;
  },

  getLastPullChangedHomeInputs() {
    return lastPullChangedHomeInputs;
  },

  getHomeInputChangeRevision() {
    return homeInputChangeRevision;
  },

  resetLastPullChangedHomeInputs() {
    lastPullChangedHomeInputs = false;
  },

  async pull(profileId = null) {
    if (isSyncBackoffActive()) {
      lastPullStatus = "deferred";
      lastPullHadUnsynced = false;
      return [];
    }
    lastPullStatus = "loading";
    lastPullHadUnsynced = false;
    let localItems = [];
    try {
      if (!AuthManager.isAuthenticated) {
        lastPullStatus = "signed-out";
        return [];
      }
      if (!shouldUseSupabaseWatchProgressSync()) {
        lastPullStatus = "skipped";
        return [];
      }
      const resolvedProfileId = resolveProfileId(profileId);
      localItems = await watchedItemsRepository.getAll(5000, resolvedProfileId);
      const lastSuccessfulPushAt = Number(
        watchedStateForProfile(resolvedProfileId).lastSuccessfulPushAt || 0
      );
      const rows = await pullRemoteWatchedItems(resolvedProfileId);
      const remoteItems = (rows || [])
        .map((row) => mapRemoteItem(row))
        .filter((item) => Boolean(item.contentId) && !isDeviceLocalWatchId(item.contentId));
      if (!remoteItems.length && localItems.length) {
        lastPullHadUnsynced = localItems.some(
          (item) =>
            !isDeviceLocalWatchId(item.contentId) &&
            Number(item.watchedAt || 0) > lastSuccessfulPushAt
        );
        lastPullStatus = "ok";
        return localItems;
      }
      const mergedItems = mergeWatchedItems(localItems, remoteItems, lastSuccessfulPushAt);
      const didChangeHomeInputs =
        homeWatchedItemsSnapshotSignature(localItems) !==
        homeWatchedItemsSnapshotSignature(mergedItems);
      lastPullChangedHomeInputs = lastPullChangedHomeInputs || didChangeHomeInputs;
      if (didChangeHomeInputs) {
        homeInputChangeRevision += 1;
      }
      await watchedItemsRepository.replaceAll(mergedItems, resolvedProfileId);
      lastPullHadUnsynced = hasUnsyncedLocalItems(localItems, remoteItems, lastSuccessfulPushAt);
      lastPullStatus = "ok";
      return mergedItems;
    } catch (error) {
      lastPullStatus = "error";
      lastPullChangedHomeInputs = true;
      console.warn("Watched items sync pull failed", error);
      return localItems;
    }
  },

  async push(profileId = null) {
    if (isSyncBackoffActive()) {
      return false;
    }
    try {
      if (!AuthManager.isAuthenticated) {
        return false;
      }
      if (!shouldUseSupabaseWatchProgressSync()) {
        return true;
      }
      const resolvedProfileId = resolveProfileId(profileId);
      const localItems = await watchedItemsRepository.getAll(5000, resolvedProfileId);
      const items = localItems.filter((item) => !isDeviceLocalWatchId(item.contentId));
      if (!items.length) {
        // Android does not send an empty full snapshot. An empty payload must
        // never be allowed to mean "delete everything" on the server.
        lastPullHadUnsynced = false;
        return true;
      }
      await SupabaseApi.rpc(
        PUSH_RPC,
        {
          p_profile_id: resolvedProfileId,
          p_items: items.map((item) => toRemoteItem(item))
        },
        true
      );
      writeWatchedStateForProfile(resolvedProfileId, { lastSuccessfulPushAt: Date.now() });
      lastPullHadUnsynced = false;
      return true;
    } catch (error) {
      console.warn("Watched items sync push failed", error);
      return false;
    }
  },

  async deleteItems(items = [], profileId = null) {
    try {
      if (isSyncBackoffActive()) {
        return false;
      }
      if (!AuthManager.isAuthenticated) {
        return false;
      }
      if (!shouldUseSupabaseWatchProgressSync()) {
        return true;
      }
      const resolvedProfileId = resolveProfileId(profileId);
      const keys = (Array.isArray(items) ? items : [])
        .filter((item) => Boolean(item?.contentId) && !isDeviceLocalWatchId(item.contentId))
        .map((item) => toDeleteKey(item));
      if (!keys.length) {
        return true;
      }
      await SupabaseApi.rpc(
        DELETE_RPC,
        {
          p_profile_id: resolvedProfileId,
          p_keys: keys
        },
        true
      );
      writeWatchedStateForProfile(resolvedProfileId, { lastSuccessfulPushAt: Date.now() });
      return true;
    } catch (error) {
      console.warn("Watched items sync delete failed", error);
      return false;
    }
  }
};
