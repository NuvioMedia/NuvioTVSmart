import { MediaServerRepository, parseServerItem } from "./mediaServerRepository.js";
import { WatchedItemsStore } from "../local/watchedItemsStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { registerSessionTeardownHandler } from "../../core/auth/sessionLifecycle.js";

let generation = 0;
let sequence = 0;
const versions = new Map();
const queues = new Map();
const pendingStates = new Map();
const itemKey = (item) =>
  JSON.stringify([
    item.contentId,
    item.season == null || item.season === "" ? null : Number(item.season),
    item.episode == null || item.episode === "" ? null : Number(item.episode)
  ]);
const versionKey = (pid, item) => `${pid}:${itemKey(item)}`;
registerSessionTeardownHandler(() => {
  generation++;
  versions.clear();
  pendingStates.clear();
});

export function hasPendingManualWatched(contentId, profileId) {
  return [...pendingStates.values()].some(
    (state) =>
      state.contentId === contentId &&
      state.profileId === String(profileId) &&
      state.profileVersion === ProfileManager.getProfileDataVersion(profileId) &&
      state.pending.size > 0
  );
}

export function beginManualWatched(items, previous, pid) {
  const token = ++sequence;
  const profileVersion = ProfileManager.getProfileDataVersion(pid);
  const keys = new Set([...items, ...previous].map((item) => versionKey(pid, item)));
  const states = new Map();
  for (const item of items) {
    const key = versionKey(pid, item);
    let state = pendingStates.get(key);
    if (!state || state.profileVersion !== profileVersion) {
      state = {
        base: previous.find((entry) => itemKey(entry) === itemKey(item)),
        baseToken: 0,
        contentId: item.contentId,
        profileId: pid,
        profileVersion,
        pending: new Set()
      };
      pendingStates.set(key, state);
    }
    state.pending.add(token);
    states.set(key, state);
  }
  keys.forEach((key) => versions.set(key, token));
  return {
    token,
    keys,
    previous,
    pid,
    generation,
    profileVersion,
    states,
    expected: new Map()
  };
}
export function manualWatchedCurrent(operation, item) {
  return (
    operation.generation === generation &&
    operation.profileVersion === ProfileManager.getProfileDataVersion(operation.pid) &&
    versions.get(versionKey(operation.pid, item)) === operation.token &&
    String(ProfileManager.getActiveProfileId() || "1") === operation.pid
  );
}
export function captureManualWatched(operation) {
  const entries = WatchedItemsStore.listForProfile(operation.pid);
  for (const key of operation.keys) {
    const item = entries.find((entry) => versionKey(operation.pid, entry) === key);
    operation.expected.set(key, JSON.stringify(item || null));
  }
}
function restore(operation, items) {
  if (
    operation.generation !== generation ||
    operation.profileVersion !== ProfileManager.getProfileDataVersion(operation.pid)
  )
    return;
  for (const item of items) {
    if (versions.get(versionKey(operation.pid, item)) !== operation.token) continue;
    const key = versionKey(operation.pid, item);
    const current = WatchedItemsStore.listForProfile(operation.pid).find(
      (entry) => itemKey(entry) === itemKey(item)
    );
    if (
      operation.expected.has(key) &&
      JSON.stringify(current || null) !== operation.expected.get(key)
    )
      continue;
    const previous = operation.states.get(key)?.base;
    if (previous) WatchedItemsStore.upsert(previous, operation.pid);
    else
      WatchedItemsStore.remove(item.contentId, operation.pid, {
        season: item.season,
        episode: item.episode,
        rootOnly: item.episode == null
      });
  }
}
export function finishManualWatched(operation, items, succeeded, played) {
  if (
    operation.generation !== generation ||
    operation.profileVersion !== ProfileManager.getProfileDataVersion(operation.pid)
  )
    return;
  const success = new Set(succeeded);
  // A newer failed action rolls back to the last confirmed state, even if it
  // began while an earlier optimistic action was still pending.
  for (const item of items) {
    const key = versionKey(operation.pid, item);
    const state = operation.states.get(key);
    if (!state) continue;
    if (success.has(item) && operation.token >= state.baseToken) {
      state.base = played
        ? WatchedItemsStore.listForProfile(operation.pid).find(
            (entry) => itemKey(entry) === itemKey(item)
          ) || item
        : undefined;
      state.baseToken = operation.token;
    }
  }
  restore(
    operation,
    items.filter((item) => !success.has(item))
  );
  for (const [key, state] of operation.states) {
    state.pending.delete(operation.token);
    if (!state.pending.size && pendingStates.get(key) === state) pendingStates.delete(key);
  }
}
function notice(pid) {
  if (String(ProfileManager.getActiveProfileId() || "1") !== pid) return;
  globalThis.document?.dispatchEvent(new CustomEvent("nuvio:server-watched-failed"));
}
function enqueue(target, played, operation, snapshot, item) {
  const key = `${operation.pid}:${target.connectionId}:${target.itemId}`;
  const pending = (queues.get(key) || Promise.resolve())
    .catch(() => {})
    .then(() => {
      if (!manualWatchedCurrent(operation, item)) throw new Error("servers_watched_failed");
      return MediaServerRepository.writeWatchedTarget(target, played, operation.pid, snapshot);
    });
  queues.set(key, pending);
  pending
    .finally(() => {
      if (queues.get(key) === pending) queues.delete(key);
    })
    .catch(() => {});
  return pending;
}
export async function applyManualServerWatched(items, played, operation) {
  const native = items.filter((item) => parseServerItem(item.contentId));
  const mirrors = items.filter((item) => !parseServerItem(item.contentId));
  const failed = new Set();
  let hadFailure = false;
  const snapshots = new Map(
    MediaServerRepository.connections(operation.pid).map((entry) => [entry.id, entry])
  );
  // Native writes are authoritative. Only failed entries are restored, provided
  // no newer action has touched that entry. Stop subsequent chunks on failure.
  for (let offset = 0; offset < native.length; offset += 6) {
    const chunk = native.slice(offset, offset + 6);
    const results = await Promise.allSettled(
      chunk.map(async (item) => {
        const targets = await MediaServerRepository.watchedTargets(item, operation.pid);
        for (const target of targets)
          await enqueue(target, played, operation, snapshots.get(target.connectionId), item);
      })
    );
    results.forEach((result, index) => {
      if (result.status === "rejected") failed.add(chunk[index]);
    });
    if (failed.size) {
      native.slice(offset + 6).forEach((item) => failed.add(item));
      break;
    }
  }
  if (failed.size) hadFailure = true;
  // Catalog mirroring is best effort, like Android: resolve ALL targets first;
  // a mirror outage must not undo local history or tracker writes.
  try {
    const targets = new Map();
    for (const item of mirrors) {
      for (const target of await MediaServerRepository.watchedTargets(item, operation.pid))
        targets.set(`${target.connectionId}:${target.itemId}`, { target, item });
    }
    const list = [...targets.values()];
    for (let offset = 0; offset < list.length; offset += 6) {
      const results = await Promise.allSettled(
        list
          .slice(offset, offset + 6)
          .map(({ target, item }) =>
            enqueue(target, played, operation, snapshots.get(target.connectionId), item)
          )
      );
      if (results.some((result) => result.status === "rejected")) {
        hadFailure = true;
        break;
      }
    }
  } catch (_) {
    hadFailure = true;
  }
  finishManualWatched(
    operation,
    items,
    items.filter((item) => !failed.has(item)),
    played
  );
  if (hadFailure && operation.generation === generation) notice(operation.pid);
  return items.filter((item) => !failed.has(item) && manualWatchedCurrent(operation, item));
}
