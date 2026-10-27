import { AuthManager } from "../auth/authManager.js";
import { ProfileManager } from "./profileManager.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { MediaServerStore } from "../../data/mediaserver/mediaServerStore.js";
import {
  toSyncedServer,
  parseSyncedServers,
  mergeSyncedServers,
  serverSyncKey
} from "../../data/mediaserver/mediaServerSyncModel.js";
import { getSyncClientId } from "../sync/syncClientIdentity.js";
import { isSyncBackoffActive, getSyncBackoffRemainingMs } from "../sync/syncBackoffPolicy.js";
import { registerSessionTeardownHandler } from "../auth/sessionLifecycle.js";

let generation = 0;
let queue = Promise.resolve();
let foregroundTimer = null;
let lastPull = 0;
let started = false;
const pushTimers = new Map();

async function scopeFor(profileId) {
  const profileVersion = ProfileManager.getProfileDataVersion(profileId);
  if (
    !AuthManager.isAuthenticated ||
    String(ProfileManager.getActiveProfileId()) !== String(profileId)
  )
    return null;
  const ownerId = String((await AuthManager.getEffectiveUserId()) || "");
  if (
    !AuthManager.isAuthenticated ||
    String(ProfileManager.getActiveProfileId()) !== String(profileId) ||
    profileVersion !== ProfileManager.getProfileDataVersion(profileId)
  )
    return null;
  return ownerId ? { ownerId, profileId: String(profileId), profileVersion } : null;
}
async function stillCurrent(scope, version) {
  if (version !== generation) return false;
  const current = await scopeFor(scope.profileId);
  return (
    version === generation &&
    current?.ownerId === scope.ownerId &&
    current?.profileVersion === scope.profileVersion
  );
}
function notifyRemoteChange() {
  globalThis.document?.dispatchEvent?.(
    new CustomEvent("nuvio:media-servers-changed", { detail: { remote: true } })
  );
}
async function push(scope, snapshot, version) {
  if (!(await stillCurrent(scope, version))) return false;
  await SupabaseApi.rpc(
    "sync_push_media_servers",
    {
      p_profile_id: Number(scope.profileId),
      p_servers: snapshot.connections.map(toSyncedServer),
      p_origin_client_id: getSyncClientId()
    },
    true
  );
  if (!(await stillCurrent(scope, version))) return false;
  MediaServerStore.markPushed(snapshot, snapshot.connections.map(serverSyncKey), scope.profileId);
  return true;
}
async function sync(profileId, pushOnly, version) {
  if (version !== generation || isSyncBackoffActive()) return false;
  const scope = await scopeFor(profileId);
  if (!scope || !(await stillCurrent(scope, version))) return false;
  const local = MediaServerStore.get(scope.profileId);
  if (local.syncedKeys != null && (pushOnly || local.pendingPush)) {
    if (local.pendingPush) await push(scope, local, version);
    return false;
  }
  const rows = await SupabaseApi.rpc(
    "sync_pull_media_servers",
    { p_profile_id: Number(scope.profileId) },
    true
  );
  if (!(await stillCurrent(scope, version))) return false;
  const remote = parseSyncedServers(rows);
  if (remote == null) {
    if (local.connections.length || local.pendingPush) await push(scope, local, version);
    return false;
  }
  const remoteKeys = remote.map(serverSyncKey);
  const merged = mergeSyncedServers(local.connections, remote, local.syncedKeys);
  if (!MediaServerStore.applySync(local, merged, remoteKeys, scope.profileId)) return false;
  const changed = JSON.stringify(local.connections) !== JSON.stringify(merged);
  if (changed) notifyRemoteChange();
  if (merged.some((connection) => !remoteKeys.includes(serverSyncKey(connection)))) {
    await push(scope, MediaServerStore.get(scope.profileId), version);
  }
  lastPull = Date.now();
  return changed;
}
function enqueue(profileId, pushOnly) {
  const version = generation;
  const operation = queue
    .catch(() => false)
    .then(() => sync(profileId, pushOnly, version))
    .catch(() => false);
  queue = operation;
  return operation;
}

export const MediaServerSyncService = {
  start() {
    if (started) return;
    started = true;
    globalThis.document?.addEventListener?.("nuvio:media-servers-changed", (event) => {
      if (!event.detail?.remote) this.requestPush();
    });
  },
  syncFromRemote(profileId = ProfileManager.getActiveProfileId()) {
    return enqueue(String(profileId), false);
  },
  requestPush(profileId = ProfileManager.getActiveProfileId()) {
    if (!AuthManager.isAuthenticated) return;
    const id = String(profileId);
    clearTimeout(pushTimers.get(id));
    pushTimers.set(
      id,
      setTimeout(
        () => {
          pushTimers.delete(id);
          if (isSyncBackoffActive()) {
            this.requestPush(id);
            return;
          }
          void enqueue(id, true);
        },
        Math.max(500, getSyncBackoffRemainingMs())
      )
    );
  },
  requestForegroundPull({ force = false } = {}) {
    if (
      !AuthManager.isAuthenticated ||
      foregroundTimer ||
      (!force && Date.now() - lastPull < 60000)
    )
      return;
    const version = generation;
    foregroundTimer = setTimeout(
      () => {
        foregroundTimer = null;
        if (version === generation) void this.syncFromRemote();
      },
      force ? 0 : 2500
    );
  },
  stop() {
    generation++;
    clearTimeout(foregroundTimer);
    foregroundTimer = null;
    lastPull = 0;
    for (const timer of pushTimers.values()) clearTimeout(timer);
    pushTimers.clear();
    return queue.then(
      () => true,
      () => true
    );
  }
};
registerSessionTeardownHandler(() => MediaServerSyncService.stop());
