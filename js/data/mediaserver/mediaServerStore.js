import { createProfileScopedStore } from "../local/profileScopedStore.js";
const store = createProfileScopedStore({
  key: "mediaServerConnections",
  seedFromPrimary: false,
  normalize: (value = {}) => ({
    connections: Array.isArray(value.connections) ? value.connections : [],
    preserved: Array.isArray(value.preserved) ? value.preserved : [],
    revision: Number(value.revision || 0),
    pendingPush: value.pendingPush === true,
    syncedKeys: Array.isArray(value.syncedKeys) ? value.syncedKeys : null
  })
});
export const MediaServerStore = {
  get: (profileId) => (profileId == null ? store.get() : store.getForProfile(profileId)),
  set(connections, profileId) {
    const current = this.get(profileId);
    return store.setForProfile(
      profileId,
      { ...current, connections, revision: current.revision + 1, pendingPush: true },
      { silentSync: true }
    );
  },
  applySync(snapshot, connections, syncedKeys, preserved, profileId) {
    const current = this.get(profileId);
    if (current.revision !== snapshot.revision) return false;
    const changed = JSON.stringify(current.connections) !== JSON.stringify(connections);
    store.setForProfile(
      profileId,
      {
        connections,
        preserved,
        syncedKeys,
        pendingPush: false,
        revision: current.revision + (changed ? 1 : 0)
      },
      { silentSync: true }
    );
    return true;
  },
  markPushed(snapshot, syncedKeys, profileId) {
    const current = this.get(profileId);
    store.setForProfile(
      profileId,
      {
        ...current,
        syncedKeys,
        pendingPush: current.revision === snapshot.revision ? false : current.pendingPush
      },
      { silentSync: true }
    );
  },
  update(id, partial, profileId) {
    return this.set(
      this.get(profileId).connections.map((entry) =>
        entry.id === id ? { ...entry, ...partial } : entry
      ),
      profileId
    );
  }
};
