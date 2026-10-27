import { LocalStore } from "../../core/storage/localStore.js";
import { registerSessionTeardownHandler } from "../../core/auth/sessionLifecycle.js";
import { MdbListAccount } from "./mdbListAccount.js";
import {
  mdbObject,
  mdbPercentage,
  mdbIds,
  mdbMatches,
  mdbAliases,
  mdbContentId,
  mdbMedia,
  mdbTime,
  mdbRecordMatches,
  invalidMdbTracking,
  decodeMdbActivities,
  decodeMdbWatched,
  decodeMdbPlayback,
  decodeMdbDropped,
  decodeMdbJournal,
  decodeMdbHistoryReceipt,
  mdbTrackingPages
} from "./mdbListTrackingCodec.js";
import { normalizeMdbSnapshot, projectMdbTracking } from "./mdbListTrackingProjection.js";

const PLAYBACK_KEY = "mdbListTrackingPlayback";
const KEY = "mdbListTracking",
  TTL = 15 * 60 * 1000;
const queues = new Map(),
  refreshes = new Map(),
  retries = new Map();
let revision = 0,
  cachedRead = null,
  cachedProjection = null;
registerSessionTeardownHandler(() => {
  revision++;
  cachedRead = null;
  cachedProjection = null;
  refreshes.clear();
  retries.clear();
});
const scopeKey = (scope) =>
  `${scope.sessionGeneration}:${scope.profileId}:${scope.generation}:${scope.profileRevision}:${scope.profileVersion}`;
function read(scope) {
  const identity = cacheIdentity(scope);
  if (cachedRead?.identity === identity) return cachedRead.snapshot;
  const cached = LocalStore.get(KEY, {})?.[scope.profileId];
  let snapshot =
    validSnapshot(cached) &&
    cached.generation === scope.generation &&
    cached.accountId === MdbListAccount.user(scope.profileId)?.id
      ? cached
      : {
          schemaVersion: 1,
          generation: scope.generation,
          accountId: MdbListAccount.user(scope.profileId)?.id,
          watched: [],
          playback: [],
          dropped: [],
          checkedAt: 0,
          initialized: false,
          invalidated: false
        };
  const sidecar = LocalStore.get(PLAYBACK_KEY, {})?.[scope.profileId];
  if (
    snapshot.storageRevision &&
    sidecar?.storageRevision === snapshot.storageRevision &&
    sidecar.generation === scope.generation &&
    sidecar.accountId === snapshot.accountId &&
    validSnapshot({ ...snapshot, playback: sidecar.playback })
  )
    snapshot = { ...snapshot, playback: sidecar.playback };
  cachedRead = { identity, snapshot };
  return snapshot;
}
function validSnapshot(snapshot) {
  if (
    snapshot?.schemaVersion !== 1 ||
    ![snapshot.watched, snapshot.playback, snapshot.dropped].every(Array.isArray)
  )
    return false;
  try {
    for (const row of [...snapshot.watched, ...snapshot.playback]) {
      if (
        !["movie", "show", "season", "episode"].includes(row?.type) ||
        !Number.isFinite(row.updatedAt)
      )
        return false;
      mdbIds(row.media?.ids);
      if (
        ["season", "episode"].includes(row.type) &&
        (!Number.isSafeInteger(row.season) || row.season < 0)
      )
        return false;
      if (row.type === "episode" && (!Number.isSafeInteger(row.episode) || row.episode < 1))
        return false;
    }
    for (const row of snapshot.playback) mdbPercentage(row.progress);
    for (const row of snapshot.dropped) {
      mdbIds(row.ids);
      if (row.season != null && (!Number.isSafeInteger(row.season) || row.season < 0)) return false;
    }
    return true;
  } catch (_) {
    return false;
  }
}

function cacheIdentity(scope) {
  return `${scopeKey(scope)}:${LocalStore.revision(KEY)}:${LocalStore.revision(PLAYBACK_KEY)}:${MdbListAccount.user(scope.profileId)?.id}`;
}
function setSnapshotMap(key, profileId, value) {
  const all = LocalStore.get(key, {}),
    before = LocalStore.revision(key);
  all[profileId] = value;
  LocalStore.set(key, all);
  if (LocalStore.revision(key) === before) throw new Error("mdblist_storage_unavailable");
}
function save(scope, snapshot) {
  MdbListAccount.check(scope);
  const previous = read(scope);
  // Pause/start/clear only update playback; avoid serializing thousands of watched episodes.
  const playbackOnly =
    previous.storageRevision &&
    Object.keys(snapshot).every((key) => key === "playback" || snapshot[key] === previous[key]);
  if (playbackOnly) {
    setSnapshotMap(PLAYBACK_KEY, scope.profileId, {
      generation: scope.generation,
      accountId: snapshot.accountId,
      storageRevision: previous.storageRevision,
      playback: snapshot.playback
    });
  } else {
    snapshot = { ...snapshot, storageRevision: `${Date.now()}:${Math.random()}` };
    setSnapshotMap(KEY, scope.profileId, snapshot);
  }
  cachedRead = { identity: cacheIdentity(scope), snapshot };
}
function serialize(scope, work) {
  const key = scopeKey(scope),
    capturedRevision = revision;
  const task = (queues.get(key) || Promise.resolve())
    .catch(() => {})
    .then(() => {
      MdbListAccount.check(scope);
      if (capturedRevision !== revision) throw new Error("mdblist_scope_changed");
      return work();
    });
  queues.set(key, task);
  void task
    .finally(() => {
      if (queues.get(key) === task) queues.delete(key);
    })
    .catch(() => {});
  return task;
}
function api(scope) {
  return (path, options) => MdbListAccount.api(scope, path, options);
}
function changed(previous, next, pattern) {
  return [...new Set([...Object.keys(previous), ...Object.keys(next)])].some(
    (key) => pattern.test(key) && previous[key] !== next[key]
  );
}
async function synchronize(scope, previous) {
  const request = api(scope),
    activities = decodeMdbActivities((await request("/sync/last_activities")).payload);
  const age =
    previous.watermark == null
      ? Infinity
      : mdbTime(activities.server_time) - mdbTime(previous.watermark);
  const full =
    !previous.initialized ||
    !previous.activities ||
    previous.invalidated ||
    age < 0 ||
    age >= 30 * 86400000;
  let watched = previous.watched,
    playback = previous.playback,
    dropped = previous.dropped;
  if (full || previous.invalidatedBuckets?.includes("watched"))
    watched = await mdbTrackingPages(request, "/sync/watched", decodeMdbWatched, {
      append_to_response: "poster"
    });
  else if (changed(previous.activities, activities, /watched|^journal_at$/)) {
    const journal = await mdbTrackingPages(request, "/sync/journal", decodeMdbJournal, {
      since: previous.watermark
    });
    if (journal === null)
      watched = await mdbTrackingPages(request, "/sync/watched", decodeMdbWatched, {
        append_to_response: "poster"
      });
    else {
      // Resolve aliases once, then apply journal changes by canonical item key.
      const normalized = normalizeMdbSnapshot({
        ...previous,
        playback: [...previous.playback, ...journal]
      });
      const mediaByAlias = new Map();
      const key = (row) =>
        `${row.type}:${mdbContentId(row.media.ids)}:${row.season}:${row.episode}`;
      for (const row of [...normalized.watched, ...normalized.playback]) {
        for (const alias of mdbAliases(row.media.ids))
          mediaByAlias.set(`${row.type === "movie" ? "movie" : "show"}:${alias}`, row.media);
      }
      const records = new Map(normalized.watched.map((row) => [key(row), row]));
      for (const change of journal.sort((a, b) => a.actionAt - b.actionAt)) {
        const alias = mdbAliases(change.media.ids)[0];
        const media =
          mediaByAlias.get(`${change.type === "movie" ? "movie" : "show"}:${alias}`) ||
          change.media;
        const record = { ...change, media },
          identity = key(record),
          known = records.get(identity);
        if (change.removed) records.delete(identity);
        else
          records.set(identity, { ...known, ...record, episodeTitle: known?.episodeTitle || null });
      }
      watched = [...records.values()];
    }
  }
  if (
    full ||
    previous.invalidatedBuckets?.includes("playback") ||
    changed(previous.activities, activities, /paused/)
  )
    playback = decodeMdbPlayback((await request("/sync/playback")).payload);
  if (full || changed(previous.activities, activities, /dropped/))
    dropped = [
      ...(await mdbTrackingPages(request, "/sync/dropped", (payload) => decodeMdbDropped(payload))),
      ...(await mdbTrackingPages(request, "/sync/seasons/dropped", (payload) =>
        decodeMdbDropped(payload, true)
      ))
    ];
  return normalizeMdbSnapshot({
    ...previous,
    watched,
    playback,
    dropped,
    activities,
    watermark: activities.server_time,
    checkedAt: Date.now(),
    initialized: true,
    invalidated: false,
    invalidatedBuckets: [],
    accountId: MdbListAccount.user(scope.profileId)?.id
  });
}
export function mdbMutationTarget(
  context,
  snapshot = { watched: [], playback: [] },
  allowWholeSeries = false
) {
  if (context.isLive === true) return null;
  const raw = String(context.contentId || ""),
    prefixed = raw.match(
      /^(imdb|tmdb|tvdb|trakt|mdblist):(?:(?:movie|series|tv|show|anime):)?([^:]+)$/
    );
  let ids;
  try {
    ids = mdbIds({
      ...(context.ids || {}),
      imdb:
        context.imdbId ||
        context.ids?.imdb ||
        (/^tt\d+$/.test(raw) ? raw : prefixed?.[1] === "imdb" ? prefixed[2] : undefined),
      ...Object.fromEntries(
        ["tmdb", "tvdb", "trakt", "mdblist"].map((key) => [
          key,
          context[`${key}Id`] ??
            context.ids?.[key] ??
            (prefixed?.[1] === key
              ? prefixed[2]
              : key === "trakt" && /^\d+$/.test(raw)
                ? raw
                : undefined)
        ])
      )
    });
  } catch (_) {
    return null;
  }
  const series = ["series", "tv", "show", "anime"].includes(context.contentType);
  const season = context.seasonNumber ?? context.season ?? null,
    episode = context.episodeNumber ?? context.episode ?? null;
  const wholeSeries = series && season == null && episode == null && allowWholeSeries;
  if (
    series &&
    !wholeSeries &&
    (!Number.isSafeInteger(season) || season < 0 || !Number.isSafeInteger(episode) || episode < 1)
  )
    return null;
  const type = series ? (wholeSeries ? "show" : "episode") : "movie";
  const records = [...snapshot.watched, ...snapshot.playback];
  const resolvedMedia = records.find(
    (row) => (row.type === "movie") === !series && mdbMatches(row.media.ids, ids)
  )?.media;
  const known = records.find(
    (row) =>
      row.type === type &&
      mdbMatches(row.media.ids, ids) &&
      ((context.episodeTmdbId && row.episodeTmdbId === context.episodeTmdbId) ||
        (context.episodeTvdbId && row.episodeTvdbId === context.episodeTvdbId) ||
        (!context.usesTvdbSeasonMapping && row.season === season && row.episode === episode))
  );
  if (context.usesTvdbSeasonMapping && !known) return null;
  return {
    type,
    media: mergeMedia(resolvedMedia || { ids: {} }, {
      ids,
      title: context.title || null,
      year: context.year || null
    }),
    season: series ? (known?.season ?? season) : null,
    episode: series ? (known?.episode ?? episode) : null,
    episodeTitle: known?.episodeTitle || context.episodeTitle || null,
    episodeTmdbId: known?.episodeTmdbId || context.episodeTmdbId || null,
    episodeTvdbId: known?.episodeTvdbId || context.episodeTvdbId || null
  };
}
function mergeMedia(preferred, fallback) {
  return {
    ...fallback,
    ...Object.fromEntries(
      Object.entries(preferred).filter(
        ([key, value]) => key !== "ids" && value != null && value !== 0
      )
    ),
    ids: { ...fallback.ids, ...preferred.ids }
  };
}

function scrobbleBody(target, progress) {
  return {
    [target.type === "movie" ? "movie" : "show"]: {
      ids: target.media.ids,
      ...(target.type === "episode" ? { season: target.season, episode: target.episode } : {})
    },
    ...(progress == null
      ? {}
      : { progress: Math.floor(Math.max(0, Math.min(100, progress)) * 100) / 100 })
  };
}
export const MdbListTracking = {
  getSnapshot() {
    return read(MdbListAccount.scope());
  },
  hasLoadedRemoteProgress() {
    return MdbListAccount.connected() && this.getSnapshot().initialized === true;
  },
  async refresh({ force = false, strict = false } = {}) {
    if (!MdbListAccount.connected()) return false;
    const scope = MdbListAccount.scope(),
      key = scopeKey(scope),
      previous = read(scope);
    if (
      !force &&
      (Date.now() < (retries.get(key) || 0) ||
        (!previous.invalidated &&
          !previous.invalidatedBuckets?.length &&
          Date.now() - previous.checkedAt < TTL))
    )
      return false;
    if (refreshes.has(key)) return refreshResult(refreshes.get(key), strict);
    const task = serialize(scope, async () => {
      if (!MdbListAccount.user(scope.profileId)) await MdbListAccount.refreshUser(scope);
      const next = await synchronize(scope, read(scope));
      save(scope, next);
      retries.delete(key);
      return true;
    })
      .catch((error) => {
        retries.set(key, Date.now() + Math.max(60000, Number(error.retryAfterMs) || 0));
        throw error;
      })
      .finally(() => {
        if (refreshes.get(key) === task) refreshes.delete(key);
      });
    refreshes.set(key, task);
    return refreshResult(task, strict);
  },
  async getWatchedItems() {
    const scope = MdbListAccount.scope();
    await queues.get(scopeKey(scope))?.catch(() => {});
    MdbListAccount.check(scope);
    await this.refresh();
    MdbListAccount.check(scope);
    return projection(this.getSnapshot()).watchedItems;
  },
  async getProgressSnapshot() {
    const scope = MdbListAccount.scope();
    await queues.get(scopeKey(scope))?.catch(() => {});
    MdbListAccount.check(scope);
    await this.refresh();
    MdbListAccount.check(scope);
    return projection(this.getSnapshot());
  },
  isHidden(contentId, season = null) {
    const snapshot = this.getSnapshot();
    const hidden = projection(snapshot).hiddenById.get(contentId);
    return hidden?.has(null) === true || hidden?.has(season) === true;
  },
  async scrobble(scope, action, context) {
    if (!Number.isFinite(context.progressPercent) || !["start", "pause", "stop"].includes(action))
      return;
    return serialize(scope, async () => {
      let snapshot = read(scope),
        target = mdbMutationTarget(context, snapshot);
      if (!target) return;
      try {
        const { payload, headers } = await MdbListAccount.api(scope, `/scrobble/${action}`, {
          method: "POST",
          body: scrobbleBody(target, context.progressPercent)
        });
        const receipt = mdbObject(payload),
          accepted = action === "start" ? ["start"] : ["pause", "stop", "scrobble"];
        if (!accepted.includes(receipt.action)) invalidMdbTracking();
        const progress = mdbPercentage(receipt.progress);
        const episode = receipt.episode == null ? null : mdbObject(receipt.episode);
        const parent = target.type === "movie" ? receipt.movie : (receipt.show ?? episode?.show);
        if (parent) {
          const media = mdbMedia(parent);
          if (!mdbMatches(media.ids, target.media.ids)) invalidMdbTracking();
          target = {
            ...target,
            media: mergeMedia(media, target.media)
          };
        }
        if (
          episode &&
          ((episode.season != null && episode.season !== target.season) ||
            ((episode.number ?? episode.episode) != null &&
              (episode.number ?? episode.episode) !== target.episode))
        )
          invalidMdbTracking();
        const at =
          receipt.watched_at ??
          receipt.paused_at ??
          (action === "start" ? receipt.started_at : null) ??
          (headers?.get("Date") && Number.isFinite(Date.parse(headers.get("Date")))
            ? new Date(headers.get("Date")).toISOString()
            : null) ??
          new Date().toISOString();
        const updatedAt = mdbTime(at);
        snapshot = {
          ...snapshot,
          playback: snapshot.playback.filter((row) => !mdbRecordMatches(row, target))
        };
        if (action !== "start") {
          if (progress >= 80)
            snapshot.watched = [
              ...snapshot.watched.filter((row) => !mdbRecordMatches(row, target)),
              { ...target, updatedAt }
            ];
          else snapshot.playback.push({ ...target, updatedAt, progress, id: receipt.id ?? null });
        }
        save(
          scope,
          action !== "start" && progress >= 80 ? normalizeMdbSnapshot(snapshot) : snapshot
        );
      } catch (error) {
        save(scope, { ...read(scope), invalidated: true });
        throw error;
      }
    });
  },
  async clearProgress(contentId, videoId = null) {
    const scope = MdbListAccount.scope();
    await this.refresh();
    MdbListAccount.check(scope);
    return serialize(scope, async () => {
      const snapshot = read(scope);
      const sessions = snapshot.playback.filter(
        (row) =>
          mdbAliases(row.media.ids).includes(contentId) &&
          (!videoId ||
            videoId === contentId ||
            videoId === `${contentId}:${row.season}:${row.episode}`)
      );
      let next = snapshot;
      for (const session of sessions) {
        try {
          const { payload } = await MdbListAccount.api(scope, "/scrobble/clear", {
            method: "POST",
            body: scrobbleBody(session)
          });
          if (payload?.action !== "clear" || typeof payload.deleted !== "boolean")
            invalidMdbTracking();
        } catch (error) {
          if (error.status !== 404) throw error;
        }
        next = {
          ...next,
          playback: next.playback.filter((row) => !mdbRecordMatches(row, session))
        };
        save(scope, next);
      }
    });
  },
  async writeHistory(items, remove = false, scope = MdbListAccount.scope()) {
    return serialize(scope, async () => {
      const initial = read(scope),
        unique = new Map();
      for (const item of items) {
        const target = mdbMutationTarget(item, initial, remove);
        if (target)
          unique.set(
            `${target.type}:${mdbContentId(target.media.ids)}:${target.season}:${target.episode}`,
            { target, item }
          );
      }
      const changes = [...unique.values()];
      for (let offset = 0; offset < changes.length; offset += 100) {
        const snapshot = read(scope),
          targets = changes.slice(offset, offset + 100);
        const body = {};
        for (const { target, item } of targets) {
          const at = new Date(item.watchedAt || Date.now()).toISOString();
          const episodeIds = {
            ...(target.episodeTmdbId ? { tmdb: target.episodeTmdbId } : {}),
            ...(target.episodeTvdbId ? { tvdb: target.episodeTvdbId } : {})
          };
          const direct = target.type === "episode" && Object.keys(episodeIds).length > 0;
          const group = target.type === "movie" ? "movies" : direct ? "episodes" : "shows";
          const row = { ids: direct ? episodeIds : target.media.ids };
          if (target.type === "episode" && !direct)
            row.seasons = [
              {
                number: target.season,
                episodes: [{ number: target.episode, ...(!remove ? { watched_at: at } : {}) }]
              }
            ];
          else if (!remove) row.watched_at = at;
          (body[group] ||= []).push(row);
        }
        try {
          const { payload } = await MdbListAccount.api(
            scope,
            remove ? "/sync/watched/remove" : "/sync/watched",
            { method: "POST", query: remove ? {} : { report_added: "true" }, body }
          );
          const receipt = decodeMdbHistoryReceipt(payload, targets, remove);
          const removed =
            remove && receipt.complete ? targets.map((row) => row.target) : receipt.confirmed;
          const watched = snapshot.watched.filter(
            (record) =>
              !removed.some(
                (target) =>
                  mdbRecordMatches(record, target) ||
                  (target.type === "show" &&
                    record.type !== "movie" &&
                    mdbMatches(target.media.ids, record.media.ids))
              )
          );
          const invalidatedBuckets = receipt.needsSnapshot
            ? [...new Set([...(snapshot.invalidatedBuckets || []), "watched"])]
            : snapshot.invalidatedBuckets;
          save(
            scope,
            normalizeMdbSnapshot({
              ...snapshot,
              watched: [...watched, ...receipt.confirmed],
              invalidatedBuckets
            })
          );
          if (!receipt.complete) throw new Error("mdblist_partial_history_write");
        } catch (error) {
          save(scope, {
            ...read(scope),
            invalidatedBuckets: [...new Set([...(read(scope).invalidatedBuckets || []), "watched"])]
          });
          throw error;
        }
      }
    });
  }
};
function projection(snapshot) {
  if (cachedProjection?.snapshot !== snapshot)
    cachedProjection = { snapshot, value: projectMdbTracking(normalizeMdbSnapshot(snapshot)) };
  return cachedProjection.value;
}

async function refreshResult(task, strict) {
  try {
    return await task;
  } catch (error) {
    if (strict) throw error;
    console.warn("MDBList tracking refresh failed", error.code || error.message);
    return false;
  }
}
