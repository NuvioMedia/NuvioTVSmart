import { AuthManager } from "../auth/authManager.js";
import { watchProgressRepository } from "../../data/repository/watchProgressRepository.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { ProfileManager } from "./profileManager.js";
import { LocalStore } from "../storage/localStore.js";
import { TraktAuthStore } from "../../data/local/traktAuthStore.js";
import { MdbListAccount } from "../../data/repository/mdbListAccount.js";
import { SimklAuthStore } from "../../data/local/simklAuthStore.js";
import { TraktSettingsStore, WatchProgressSource } from "../../data/local/traktSettingsStore.js";
import { getSyncClientId } from "../sync/syncClientIdentity.js";
import { isSyncBackoffActive } from "../sync/syncBackoffPolicy.js";

const PULL_RPC = "sync_pull_watch_progress";
const PUSH_RPC = "sync_push_watch_progress";
const DELETE_RPC = "sync_delete_watch_progress";
const SYNTHETIC_EPISODE_VIDEO_PREFIX = "__nuvio_episode__:";
const PUSH_RETRY_BACKOFF_MS = 120000;
const SYNC_STATE_KEY = "watchProgressSyncState";
const MIN_PROGRESS_SYNC_DURATION_MS = 60000;
const MAX_AMBIGUOUS_SECONDS_PROGRESS_VALUE = 8 * 60 * 60;
const MAX_REASONABLE_PROGRESS_DURATION_MS = 24 * 60 * 60 * 1000;

let activePushPromise = null;
let pushAgainRequested = false;
const pushStateByProfile = new Map();
let lastPullStatus = "idle";
let lastPullHadUnsynced = false;
let lastPullChangedHomeInputs = false;
let homeInputChangeRevision = 0;

function pushStateForProfile(profileId) {
  const key = String(profileId || "1");
  const profileVersion = ProfileManager.getProfileDataVersion(profileId);
  if (
    !pushStateByProfile.has(key) ||
    pushStateByProfile.get(key).profileVersion !== profileVersion
  ) {
    pushStateByProfile.set(key, {
      profileVersion,
      lastSuccessfulPushSignature: "",
      lastFailedPushSignature: "",
      lastFailedPushAt: 0
    });
  }
  return pushStateByProfile.get(key);
}

function progressKey(item = {}) {
  return toProgressKey(item);
}

function normalizeProgressItems(items = []) {
  const byKey = new Map();
  (Array.isArray(items) ? items : [])
    .filter((item) => Boolean(item?.contentId))
    .forEach((item) => {
      const key = progressKey(item);
      const existing = byKey.get(key);
      if (!existing || Number(item.updatedAt || 0) > Number(existing.updatedAt || 0)) {
        byKey.set(key, item);
      }
    });
  return Array.from(byKey.values()).sort(
    (left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0)
  );
}

function progressContentSignature(item = {}) {
  return JSON.stringify([
    String(item.contentId || ""),
    String(item.contentType || "movie"),
    String(item.videoId || ""),
    Number(item.season || 0),
    Number(item.episode || 0),
    Number(item.positionMs || 0),
    Number(item.durationMs || 0),
    Number(item.updatedAt || 0)
  ]);
}

function homeProgressSnapshotSignature(items = []) {
  return buildPushSignature(buildRemoteProgressEntries(coalesceSyncItems(items)));
}

function itemsByProgressKey(items = []) {
  return new Map(normalizeProgressItems(items).map((item) => [progressKey(item), item]));
}

// Supabase stores the portable progress fields only. Keep device-local metadata
// when the matching remote row wins a merge, just as Android preserves display
// metadata while merging watch progress. streamIdentity is also local-only and
// is what Continue Watching uses to reopen the source selected for this item.
function preserveLocalProgressMetadata(progress, localItem) {
  if (!progress || !localItem) {
    return progress;
  }
  const localTitle = String(localItem.title || "").trim();
  const localStreamIdentity = String(localItem.streamIdentity || "").trim();
  return {
    ...progress,
    ...(localTitle ? { title: localItem.title } : {}),
    ...(localItem.poster ? { poster: localItem.poster } : {}),
    ...(localItem.background ? { background: localItem.background } : {}),
    ...(localItem.logo ? { logo: localItem.logo } : {}),
    ...(localItem.episodeTitle ? { episodeTitle: localItem.episodeTitle } : {}),
    ...(localItem.imdbId ? { imdbId: localItem.imdbId } : {}),
    ...(localItem.tmdbId ? { tmdbId: localItem.tmdbId } : {}),
    ...(localItem.traktId ? { traktId: localItem.traktId } : {}),
    ...(localItem.year ? { year: localItem.year } : {}),
    ...(localStreamIdentity ? { streamIdentity: localItem.streamIdentity } : {})
  };
}

function readSyncState() {
  const state = LocalStore.get(SYNC_STATE_KEY, {});
  return state && typeof state === "object" ? state : {};
}

function readProfileSyncState(profileId) {
  const state = readSyncState();
  const profileState = state[String(profileId)] || {};
  return profileState && typeof profileState === "object" ? profileState : {};
}

function readPendingDeleteKeys(profileId) {
  const profileState = readProfileSyncState(profileId);
  return new Set(
    (Array.isArray(profileState.pendingDeleteKeys) ? profileState.pendingDeleteKeys : [])
      .map((key) => String(key || "").trim())
      .filter(Boolean)
  );
}

function writeProfileSyncState(profileId, patch = {}) {
  const state = readSyncState();
  const profileKey = String(profileId);
  state[profileKey] = {
    ...(state[profileKey] || {}),
    ...patch,
    updatedAt: Date.now()
  };
  LocalStore.set(SYNC_STATE_KEY, state);
}

function writePendingDeleteKeys(profileId, keys = []) {
  writeProfileSyncState(profileId, {
    pendingDeleteKeys: Array.from(
      new Set(keys.map((key) => String(key || "").trim()).filter(Boolean))
    )
  });
}

function addPendingDeleteKeys(profileId, keys = []) {
  const pending = readPendingDeleteKeys(profileId);
  keys.forEach((key) => {
    const normalized = String(key || "").trim();
    if (normalized) {
      pending.add(normalized);
    }
  });
  writePendingDeleteKeys(profileId, Array.from(pending));
}

function removePendingDeleteKeys(profileId, keys = []) {
  const pending = readPendingDeleteKeys(profileId);
  keys.forEach((key) => pending.delete(String(key || "").trim()));
  writePendingDeleteKeys(profileId, Array.from(pending));
}

function readBaselineItems(profileId) {
  const profileState = readProfileSyncState(profileId);
  return normalizeProgressItems(profileState.remoteSnapshot || []);
}

function writeBaselineItems(profileId, items = []) {
  writeProfileSyncState(profileId, { remoteSnapshot: normalizeProgressItems(items) });
}

function mergeProgressItems(
  localItems = [],
  remoteItems = [],
  baselineItems = [],
  pendingDeleteKeys = []
) {
  const localByKey = itemsByProgressKey(localItems);
  const remoteByKey = itemsByProgressKey(remoteItems);
  const baselineByKey = itemsByProgressKey(baselineItems);
  const pendingDeleteSet = new Set(pendingDeleteKeys);
  const keys = new Set([...localByKey.keys(), ...remoteByKey.keys(), ...baselineByKey.keys()]);
  const merged = [];

  keys.forEach((key) => {
    if (pendingDeleteSet.has(key)) {
      return;
    }
    const localItem = localByKey.get(key) || null;
    const remoteItem = remoteByKey.get(key) || null;
    const baselineItem = baselineByKey.get(key) || null;

    if (localItem && remoteItem) {
      const localChanged =
        !baselineItem ||
        progressContentSignature(localItem) !== progressContentSignature(baselineItem);
      const remoteChanged =
        !baselineItem ||
        progressContentSignature(remoteItem) !== progressContentSignature(baselineItem);
      if (localChanged && !remoteChanged) {
        merged.push(localItem);
        return;
      }
      if (remoteChanged && !localChanged) {
        merged.push(preserveLocalProgressMetadata(remoteItem, localItem));
        return;
      }
      const winner =
        Number(localItem.updatedAt || 0) > Number(remoteItem.updatedAt || 0)
          ? localItem
          : remoteItem;
      merged.push(preserveLocalProgressMetadata(winner, localItem));
      return;
    }

    if (remoteItem && !localItem) {
      // Android rehydrates every row returned by the remote snapshot when the
      // local entry is missing. The baseline is only the last observed remote
      // snapshot; treating an unchanged row as a local deletion loses progress
      // after a local store reset or partial corruption. Explicit deletions are
      // protected by a pending-delete key until their remote mutation succeeds.
      merged.push(remoteItem);
      return;
    }

    if (localItem && !remoteItem) {
      const localChanged =
        baselineItem &&
        progressContentSignature(localItem) !== progressContentSignature(baselineItem);
      if (!baselineItem || localChanged) {
        merged.push(localItem);
      }
    }
  });

  return normalizeProgressItems(merged);
}

function mapProgressRow(row = {}) {
  const contentId = row.content_id || row.contentId || "";
  const contentType = row.content_type || row.contentType || "movie";
  const source = String(row.source || "").trim();
  const updatedAtRaw = row.updated_at ?? row.last_watched ?? row.lastWatched ?? null;
  const updatedAt = (() => {
    if (updatedAtRaw == null) {
      return Date.now();
    }
    const numeric = Number(updatedAtRaw);
    if (Number.isFinite(numeric)) {
      return numeric > 1_000_000_000_000 ? numeric : Math.trunc(numeric * 1000);
    }
    const parsed = new Date(updatedAtRaw).getTime();
    return Number.isFinite(parsed) ? parsed : Date.now();
  })();
  const hasPositionMs = row.position_ms != null || row.positionMs != null;
  const hasDurationMs = row.duration_ms != null || row.durationMs != null;
  const positionMsRaw = row.position_ms ?? row.positionMs ?? row.position ?? 0;
  const durationMsRaw = row.duration_ms ?? row.durationMs ?? row.duration ?? 0;
  const progressPercentRaw = row.progress_percent ?? row.progressPercent ?? null;
  const progressPercent = Number(progressPercentRaw);
  const seasonRaw = row.season ?? row.season_number ?? null;
  const episodeRaw = row.episode ?? row.episode_number ?? null;
  const seasonNum = Number(seasonRaw);
  const episodeNum = Number(episodeRaw);
  const rawVideoId = row.video_id || row.videoId || null;
  const normalizedVideoId =
    typeof rawVideoId === "string" && rawVideoId.trim() === contentId ? null : rawVideoId;
  const toMilliseconds = (value) => {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) {
      return 0;
    }
    return Math.trunc(n);
  };
  const normalizeAmbiguousRemoteTime = (value, useMilliseconds = false) => {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) {
      return 0;
    }
    return Math.trunc(useMilliseconds || n > MAX_AMBIGUOUS_SECONDS_PROGRESS_VALUE ? n : n * 1000);
  };
  // The legacy RPC fields have no unit suffix. Infer one unit for the pair
  // from its duration so a small millisecond position is not mistaken for
  // seconds while historical second-based rows remain compatible.
  const hasLegacyTimePair = !hasPositionMs && !hasDurationMs;
  const legacyDuration = Number(durationMsRaw);
  const legacyPairUsesMilliseconds =
    hasLegacyTimePair &&
    Number.isFinite(legacyDuration) &&
    legacyDuration > MAX_AMBIGUOUS_SECONDS_PROGRESS_VALUE;
  const positionMs = hasPositionMs
    ? toMilliseconds(positionMsRaw)
    : normalizeAmbiguousRemoteTime(positionMsRaw, legacyPairUsesMilliseconds);
  const durationMs = hasDurationMs
    ? toMilliseconds(durationMsRaw)
    : normalizeAmbiguousRemoteTime(durationMsRaw, legacyPairUsesMilliseconds);
  const normalizedTimes = normalizeInflatedProgressTimes(positionMs, durationMs);
  const normalizedProgressPercent = Number.isFinite(progressPercent)
    ? Math.max(0, Math.min(100, progressPercent))
    : null;
  const completedProgressPercent =
    source === "trakt_history" &&
    normalizedProgressPercent != null &&
    normalizedProgressPercent < 100
      ? 100
      : normalizedProgressPercent;
  return {
    contentId,
    contentType,
    videoId:
      typeof normalizedVideoId === "string" &&
      normalizedVideoId.startsWith(SYNTHETIC_EPISODE_VIDEO_PREFIX)
        ? null
        : normalizedVideoId,
    season: seasonRaw != null && Number.isFinite(seasonNum) && seasonNum >= 0 ? seasonNum : null,
    episode: Number.isFinite(episodeNum) && episodeNum > 0 ? episodeNum : null,
    positionMs: normalizedTimes.positionMs,
    durationMs: normalizedTimes.durationMs,
    progressPercent: completedProgressPercent,
    source: source || "local",
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now()
  };
}

function normalizeInflatedProgressTimes(positionMs = 0, durationMs = 0) {
  const position = Number(positionMs || 0);
  const duration = Number(durationMs || 0);
  if (
    Number.isFinite(duration) &&
    duration > MAX_REASONABLE_PROGRESS_DURATION_MS &&
    duration / 1000 <= MAX_REASONABLE_PROGRESS_DURATION_MS
  ) {
    return {
      positionMs: Number.isFinite(position) && position > 0 ? Math.trunc(position / 1000) : 0,
      durationMs: Math.trunc(duration / 1000)
    };
  }
  return {
    positionMs: Number.isFinite(position) && position > 0 ? Math.trunc(position) : 0,
    durationMs: Number.isFinite(duration) && duration > 0 ? Math.trunc(duration) : 0
  };
}

function resolveProfileId(profileId = null) {
  const raw = Number(profileId ?? ProfileManager.getActiveProfileId() ?? 1);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.trunc(raw);
  }
  return 1;
}

function shouldUseSupabaseWatchProgressSync() {
  const source = TraktSettingsStore.get().watchProgressSource || WatchProgressSource.TRAKT;
  const providerSelected =
    (TraktAuthStore.isAuthenticated() && source === WatchProgressSource.TRAKT) ||
    (SimklAuthStore.isAuthenticated() && source === WatchProgressSource.SIMKL) ||
    (MdbListAccount.connected() && source === WatchProgressSource.MDBLIST);
  return !providerSelected;
}

function toPositiveIntegerOrNull(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  return Math.trunc(n);
}

function toNonNegativeIntegerOrNull(value) {
  if (value == null || value === "") {
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return null;
  }
  return Math.trunc(n);
}

function toRemoteVideoId(item = {}) {
  const explicitVideoId = String(item.videoId || "").trim();
  const contentId = String(item.contentId || "").trim();
  if (explicitVideoId && explicitVideoId !== "main" && explicitVideoId !== contentId) {
    return explicitVideoId;
  }
  const season = toNonNegativeIntegerOrNull(item.season);
  const episode = toPositiveIntegerOrNull(item.episode);
  if (season != null || episode != null) {
    return `${SYNTHETIC_EPISODE_VIDEO_PREFIX}${season || 0}:${episode || 0}`;
  }
  if (contentId) {
    return contentId;
  }
  return "main";
}

function toProgressKey(item = {}) {
  const contentId = String(item.contentId || "").trim();
  const season = toNonNegativeIntegerOrNull(item.season);
  const episode = toPositiveIntegerOrNull(item.episode);
  if (contentId && season != null && episode != null) {
    return `${contentId}_s${season}e${episode}`;
  }
  return contentId;
}

function syncIdentityKey(item = {}) {
  return toProgressKey(item);
}

function dedupeSyncItems(items = []) {
  const byKey = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const contentId = String(item?.contentId || "").trim();
    if (!contentId) {
      return;
    }
    const key = toProgressKey(item);
    const existing = byKey.get(key);
    if (!existing || Number(item?.updatedAt || 0) > Number(existing?.updatedAt || 0)) {
      byKey.set(key, item);
    }
  });
  return Array.from(byKey.values()).sort(
    (left, right) => Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0)
  );
}

function coalesceSyncItems(items = []) {
  const byIdentity = new Map();
  dedupeSyncItems(items).forEach((item) => {
    const key = syncIdentityKey(item);
    const existing = byIdentity.get(key);
    if (!existing || Number(item?.updatedAt || 0) > Number(existing?.updatedAt || 0)) {
      byIdentity.set(key, item);
    }
  });
  return Array.from(byIdentity.values()).sort(
    (left, right) => Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0)
  );
}

function isSyncableProgressItem(item = {}) {
  const durationMs = Number(item?.durationMs || 0);
  return (
    !Number.isFinite(durationMs) || durationMs <= 0 || durationMs >= MIN_PROGRESS_SYNC_DURATION_MS
  );
}

function rowFreshness(row = {}) {
  const candidates = [row?.updated_at, row?.last_watched, row?.updatedAt];
  for (const value of candidates) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
    const parsed = Date.parse(String(value || ""));
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function dedupeRowsForConflict(rows = [], onConflict = "") {
  const columns = String(onConflict || "")
    .split(",")
    .map((column) => String(column || "").trim())
    .filter(Boolean);
  if (!columns.length) {
    return Array.isArray(rows) ? rows : [];
  }
  const byKey = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = columns
      .map((column) => {
        const value = row?.[column];
        return value == null ? "" : String(value);
      })
      .join("::");
    const existing = byKey.get(key);
    if (!existing || rowFreshness(row) >= rowFreshness(existing)) {
      byKey.set(key, row);
    }
  });
  return Array.from(byKey.values());
}

function dedupeRemoteProgressEntries(rows = []) {
  return dedupeRowsForConflict(
    dedupeRowsForConflict(rows, "progress_key"),
    "content_id,video_id,season,episode"
  );
}

function buildRemoteProgressEntries(items = []) {
  return dedupeRemoteProgressEntries(
    items.map((item) => ({
      content_id: item.contentId,
      content_type: item.contentType || "movie",
      video_id: toRemoteVideoId(item),
      season: item.season == null ? null : Number(item.season),
      episode: item.episode == null ? null : Number(item.episode),
      position: Math.max(0, Math.trunc(Number(item.positionMs || 0))),
      duration: Math.max(0, Math.trunc(Number(item.durationMs || 0))),
      last_watched: Number(item.updatedAt || Date.now()),
      progress_key: toProgressKey(item)
    }))
  );
}

function buildDeleteKeys(items = []) {
  const keys = new Set();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const key = toProgressKey(item);
    if (key) {
      keys.add(key);
    }
  });
  return Array.from(keys);
}

async function deleteRemoteProgressKeys(keys = [], profileId = null) {
  const normalizedKeys = Array.from(
    new Set(
      (Array.isArray(keys) ? keys : []).map((key) => String(key || "").trim()).filter(Boolean)
    )
  );
  if (!normalizedKeys.length) {
    return;
  }
  await SupabaseApi.rpc(
    DELETE_RPC,
    {
      p_profile_id: resolveProfileId(profileId),
      p_keys: normalizedKeys,
      p_origin_client_id: getSyncClientId()
    },
    true
  );
}

function buildPushSignature(rows = []) {
  return JSON.stringify(
    (Array.isArray(rows) ? rows : []).map((row) => [
      String(row.progress_key || ""),
      String(row.video_id || ""),
      Number(row.season || 0),
      Number(row.episode || 0),
      Number(row.position || 0),
      Number(row.duration || 0)
    ])
  );
}

async function pushOnce(profileId = null) {
  let pushSignature = "";
  const resolvedProfileId = resolveProfileId(profileId);
  const pushState = pushStateForProfile(resolvedProfileId);
  try {
    if (!AuthManager.isAuthenticated) {
      return false;
    }
    const localItems = coalesceSyncItems(await watchProgressRepository.getAll(resolvedProfileId));
    const localKeys = new Set(localItems.map((item) => progressKey(item)));
    const pendingDeleteKeys = readPendingDeleteKeys(resolvedProfileId);
    const canceledDeleteKeys = Array.from(pendingDeleteKeys).filter((key) => localKeys.has(key));
    if (canceledDeleteKeys.length) {
      canceledDeleteKeys.forEach((key) => pendingDeleteKeys.delete(key));
      writePendingDeleteKeys(resolvedProfileId, Array.from(pendingDeleteKeys));
    }
    const retryDeleteKeys = Array.from(pendingDeleteKeys);
    if (retryDeleteKeys.length) {
      await deleteRemoteProgressKeys(retryDeleteKeys, resolvedProfileId);
      removePendingDeleteKeys(resolvedProfileId, retryDeleteKeys);
    }
    const items = localItems.filter((item) => isSyncableProgressItem(item));
    const rows = buildRemoteProgressEntries(items);
    pushSignature = buildPushSignature(rows);
    if (!rows.length) {
      // An empty payload is not a safe way to express deletion. Deletions use
      // the explicit delete RPC below, so never let a transiently empty local
      // snapshot replace the remote progress set.
      pushState.lastFailedPushSignature = "";
      pushState.lastFailedPushAt = 0;
      return true;
    }
    if (pushSignature && pushSignature === pushState.lastSuccessfulPushSignature) {
      return true;
    }
    if (
      pushSignature &&
      pushSignature === pushState.lastFailedPushSignature &&
      Date.now() - Number(pushState.lastFailedPushAt || 0) < PUSH_RETRY_BACKOFF_MS
    ) {
      return false;
    }
    await SupabaseApi.rpc(
      PUSH_RPC,
      {
        p_profile_id: resolvedProfileId,
        p_entries: rows,
        p_origin_client_id: getSyncClientId()
      },
      true
    );
    pushState.lastSuccessfulPushSignature = pushSignature;
    writeBaselineItems(resolvedProfileId, items);
    pushState.lastFailedPushSignature = "";
    pushState.lastFailedPushAt = 0;
    return true;
  } catch (error) {
    if (typeof pushSignature === "string" && pushSignature) {
      pushState.lastFailedPushSignature = pushSignature;
    }
    pushState.lastFailedPushAt = Date.now();
    console.warn("Watch progress sync push failed", error);
    return false;
  }
}

export const WatchProgressSyncService = {
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
      localItems = await watchProgressRepository.getAll(resolvedProfileId);
      const pendingDeleteKeys = readPendingDeleteKeys(resolvedProfileId);
      const localKeys = new Set(localItems.map((item) => progressKey(item)));
      const canceledDeleteKeys = Array.from(pendingDeleteKeys).filter((key) => localKeys.has(key));
      if (canceledDeleteKeys.length) {
        canceledDeleteKeys.forEach((key) => pendingDeleteKeys.delete(key));
        writePendingDeleteKeys(resolvedProfileId, Array.from(pendingDeleteKeys));
      }
      const retryDeleteKeys = Array.from(pendingDeleteKeys);
      if (retryDeleteKeys.length) {
        try {
          await deleteRemoteProgressKeys(retryDeleteKeys, resolvedProfileId);
          removePendingDeleteKeys(resolvedProfileId, retryDeleteKeys);
        } catch (error) {
          console.warn("Watch progress pending delete retry failed", error);
        }
      }
      const rows = await SupabaseApi.rpc(PULL_RPC, { p_profile_id: resolvedProfileId }, true);
      if (!Array.isArray(rows)) {
        const error = new Error("Watch progress sync returned an invalid snapshot");
        error.code = "INVALID_SYNC_SNAPSHOT";
        throw error;
      }
      const filteredRows = rows.filter((row) => {
        const rowProfile = row?.profile_id ?? row?.profileId ?? null;
        if (rowProfile == null || rowProfile === "") {
          return true;
        }
        return String(rowProfile) === String(resolvedProfileId);
      });
      const remoteItems = filteredRows
        .map((row) => mapProgressRow(row))
        .filter((item) => Boolean(item.contentId) && isSyncableProgressItem(item));
      const snapshotItems = normalizeProgressItems(remoteItems);
      if (!snapshotItems.length && localItems.length) {
        // Android keeps the local snapshot when the remote endpoint returns
        // an empty list: an empty response may be a wrong profile, owner,
        // authorization result, or a backend outage rather than a deletion.
        // Do not advance the baseline or schedule an empty push.
        lastPullStatus = "ok";
        lastPullHadUnsynced = false;
        return localItems;
      }
      const remoteKeys = new Set(snapshotItems.map((item) => progressKey(item)));
      const confirmedDeleteKeys = Array.from(readPendingDeleteKeys(resolvedProfileId)).filter(
        (key) => !remoteKeys.has(key)
      );
      if (confirmedDeleteKeys.length) {
        removePendingDeleteKeys(resolvedProfileId, confirmedDeleteKeys);
      }
      const baselineItems = readBaselineItems(resolvedProfileId);
      const mergedItems = mergeProgressItems(
        localItems,
        snapshotItems,
        baselineItems,
        readPendingDeleteKeys(resolvedProfileId)
      );
      const remoteSignature = buildPushSignature(
        buildRemoteProgressEntries(coalesceSyncItems(snapshotItems))
      );
      const mergedSignature = buildPushSignature(
        buildRemoteProgressEntries(coalesceSyncItems(mergedItems))
      );
      const didChangeHomeInputs = homeProgressSnapshotSignature(localItems) !== mergedSignature;
      lastPullChangedHomeInputs = lastPullChangedHomeInputs || didChangeHomeInputs;
      if (didChangeHomeInputs) {
        homeInputChangeRevision += 1;
      }
      lastPullHadUnsynced = mergedSignature !== remoteSignature;
      writeBaselineItems(resolvedProfileId, snapshotItems);
      pushStateForProfile(resolvedProfileId).lastSuccessfulPushSignature = remoteSignature;
      await watchProgressRepository.replaceAll(mergedItems, resolvedProfileId);
      lastPullStatus = "ok";
      return mergedItems;
    } catch (error) {
      lastPullStatus = "error";
      lastPullChangedHomeInputs = true;
      console.warn("Watch progress sync pull failed", error);
      return localItems;
    }
  },

  async push(profileId = null) {
    if (isSyncBackoffActive()) {
      return false;
    }
    if (activePushPromise) {
      pushAgainRequested = true;
      return activePushPromise;
    }
    const resolvedProfileId = resolveProfileId(profileId);
    activePushPromise = (async () => {
      let lastResult = false;
      do {
        pushAgainRequested = false;
        lastResult = await pushOnce(resolvedProfileId);
      } while (pushAgainRequested);
      return lastResult;
    })().finally(() => {
      activePushPromise = null;
    });
    return activePushPromise;
  },

  async deleteItems(items = [], profileId = null) {
    try {
      const resolvedProfileId = resolveProfileId(profileId);
      const keys = buildDeleteKeys(items);
      if (!keys.length) {
        return true;
      }
      if (!AuthManager.isAuthenticated) {
        return false;
      }
      if (!shouldUseSupabaseWatchProgressSync()) {
        return true;
      }
      addPendingDeleteKeys(resolvedProfileId, keys);
      if (isSyncBackoffActive()) {
        return false;
      }
      await deleteRemoteProgressKeys(keys, resolvedProfileId);
      removePendingDeleteKeys(resolvedProfileId, keys);
      const baselineByKey = itemsByProgressKey(readBaselineItems(resolvedProfileId));
      normalizeProgressItems(items).forEach((item) => {
        baselineByKey.delete(progressKey(item));
      });
      writeBaselineItems(resolvedProfileId, Array.from(baselineByKey.values()));
      pushStateForProfile(resolvedProfileId).lastSuccessfulPushSignature = "";
      return true;
    } catch (error) {
      console.warn("Watch progress sync delete failed", error);
      return false;
    }
  }
};
