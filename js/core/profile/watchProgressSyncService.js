import { AuthManager } from "../auth/authManager.js";
import { watchProgressRepository } from "../../data/repository/watchProgressRepository.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { ProfileManager } from "./profileManager.js";
import { LocalStore } from "../storage/localStore.js";
import { TraktAuthStore } from "../../data/local/traktAuthStore.js";
import { TraktSettingsStore, WatchProgressSource } from "../../data/local/traktSettingsStore.js";

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
let lastSuccessfulPushSignature = "";
let lastFailedPushSignature = "";
let lastFailedPushAt = 0;

function progressKey(item = {}) {
  const contentId = String(item.contentId || "").trim();
  const videoId = String(item.videoId || "main").trim();
  const season = item.season == null ? "" : String(Number(item.season));
  const episode = item.episode == null ? "" : String(Number(item.episode));
  return `${contentId}::${videoId}::${season}::${episode}`;
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

function readBaselineItems(profileId) {
  const state = readSyncState();
  const profileState = state[String(profileId)] || {};
  return normalizeProgressItems(profileState.remoteSnapshot || []);
}

function writeBaselineItems(profileId, items = []) {
  const state = readSyncState();
  state[String(profileId)] = {
    remoteSnapshot: normalizeProgressItems(items),
    updatedAt: Date.now()
  };
  LocalStore.set(SYNC_STATE_KEY, state);
}

function mergeProgressItems(localItems = [], remoteItems = [], baselineItems = []) {
  const localByKey = itemsByProgressKey(localItems);
  const remoteByKey = itemsByProgressKey(remoteItems);
  const baselineByKey = itemsByProgressKey(baselineItems);
  const keys = new Set([...localByKey.keys(), ...remoteByKey.keys(), ...baselineByKey.keys()]);
  const merged = [];

  keys.forEach((key) => {
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
      const remoteChanged =
        baselineItem &&
        progressContentSignature(remoteItem) !== progressContentSignature(baselineItem);
      if (!baselineItem || remoteChanged) {
        merged.push(remoteItem);
      }
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
  const normalizeAmbiguousRemoteTime = (value) => {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) {
      return 0;
    }
    return Math.trunc(n > MAX_AMBIGUOUS_SECONDS_PROGRESS_VALUE ? n : n * 1000);
  };
  const positionMs = hasPositionMs
    ? toMilliseconds(positionMsRaw)
    : normalizeAmbiguousRemoteTime(positionMsRaw);
  const durationMs = hasDurationMs
    ? toMilliseconds(durationMsRaw)
    : normalizeAmbiguousRemoteTime(durationMsRaw);
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

function resolveProfileId() {
  const raw = Number(ProfileManager.getActiveProfileId() || 1);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.trunc(raw);
  }
  return 1;
}

function shouldUseSupabaseWatchProgressSync() {
  const source = TraktSettingsStore.get().watchProgressSource || WatchProgressSource.TRAKT;
  return !(TraktAuthStore.isAuthenticated() && source === WatchProgressSource.TRAKT);
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
  const contentId = String(item.contentId || "").trim();
  const season = toNonNegativeIntegerOrNull(item.season);
  const episode = toPositiveIntegerOrNull(item.episode);
  if (contentId && season != null && episode != null) {
    return `${contentId}:episode:${season}:${episode}`;
  }
  return `${contentId}:video:${toRemoteVideoId(item)}`;
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

function buildPushSignature(rows = []) {
  return JSON.stringify(
    (Array.isArray(rows) ? rows : []).map((row) => [
      String(row.progress_key || ""),
      String(row.video_id || ""),
      Number(row.season || 0),
      Number(row.episode || 0),
      Number(row.position || 0),
      Number(row.duration || 0),
      Number(row.last_watched || 0)
    ])
  );
}

async function pushOnce() {
  let pushSignature = "";
  try {
    if (!AuthManager.isAuthenticated) {
      return false;
    }
    const items = coalesceSyncItems(await watchProgressRepository.getAll()).filter((item) =>
      isSyncableProgressItem(item)
    );
    const profileId = resolveProfileId();
    const rows = buildRemoteProgressEntries(items);
    pushSignature = buildPushSignature(rows);
    if (pushSignature && pushSignature === lastSuccessfulPushSignature) {
      return true;
    }
    if (
      pushSignature &&
      pushSignature === lastFailedPushSignature &&
      Date.now() - Number(lastFailedPushAt || 0) < PUSH_RETRY_BACKOFF_MS
    ) {
      return false;
    }
    await SupabaseApi.rpc(
      PUSH_RPC,
      {
        p_profile_id: profileId,
        p_entries: rows
      },
      true
    );
    lastSuccessfulPushSignature = pushSignature;
    writeBaselineItems(profileId, items);
    lastFailedPushSignature = "";
    lastFailedPushAt = 0;
    return true;
  } catch (error) {
    if (typeof pushSignature === "string" && pushSignature) {
      lastFailedPushSignature = pushSignature;
    }
    lastFailedPushAt = Date.now();
    console.warn("Watch progress sync push failed", error);
    return false;
  }
}

export const WatchProgressSyncService = {
  async pull() {
    try {
      if (!AuthManager.isAuthenticated) {
        return [];
      }
      if (!shouldUseSupabaseWatchProgressSync()) {
        return [];
      }
      const localItems = await watchProgressRepository.getAll();
      const profileId = resolveProfileId();
      const rows = await SupabaseApi.rpc(PULL_RPC, { p_profile_id: profileId }, true);
      const filteredRows = (Array.isArray(rows) ? rows : []).filter((row) => {
        const rowProfile = row?.profile_id ?? row?.profileId ?? null;
        if (rowProfile == null || rowProfile === "") {
          return true;
        }
        return String(rowProfile) === String(profileId);
      });
      const remoteItems = filteredRows
        .map((row) => mapProgressRow(row))
        .filter((item) => Boolean(item.contentId) && isSyncableProgressItem(item));
      const snapshotItems = normalizeProgressItems(remoteItems);
      const baselineItems = readBaselineItems(profileId);
      const mergedItems = mergeProgressItems(localItems, snapshotItems, baselineItems);
      writeBaselineItems(profileId, snapshotItems);
      lastSuccessfulPushSignature = buildPushSignature(
        buildRemoteProgressEntries(coalesceSyncItems(snapshotItems))
      );
      await watchProgressRepository.replaceAll(mergedItems);
      return mergedItems;
    } catch (error) {
      console.warn("Watch progress sync pull failed", error);
      return [];
    }
  },

  async push() {
    if (activePushPromise) {
      pushAgainRequested = true;
      return activePushPromise;
    }
    activePushPromise = (async () => {
      let lastResult = false;
      do {
        pushAgainRequested = false;
        lastResult = await pushOnce();
      } while (pushAgainRequested);
      return lastResult;
    })().finally(() => {
      activePushPromise = null;
    });
    return activePushPromise;
  },

  async deleteItems(items = []) {
    try {
      if (!AuthManager.isAuthenticated) {
        return false;
      }
      if (!shouldUseSupabaseWatchProgressSync()) {
        return true;
      }
      const keys = buildDeleteKeys(items);
      if (!keys.length) {
        return true;
      }
      await SupabaseApi.rpc(
        DELETE_RPC,
        {
          p_profile_id: resolveProfileId(),
          p_keys: keys
        },
        true
      );
      const profileId = resolveProfileId();
      const baselineByKey = itemsByProgressKey(readBaselineItems(profileId));
      normalizeProgressItems(items).forEach((item) => {
        baselineByKey.delete(progressKey(item));
      });
      writeBaselineItems(profileId, Array.from(baselineByKey.values()));
      lastSuccessfulPushSignature = "";
      return true;
    } catch (error) {
      console.warn("Watch progress sync delete failed", error);
      return false;
    }
  }
};
