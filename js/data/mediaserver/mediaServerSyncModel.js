import { normalizeMediaServerAddress } from "./mediaBrowserClient.js";

export const serverSyncKey = (server) =>
  `${server.providerId}|${server.remoteServerId}|${server.remoteUserId}`;

export function toSyncedServer(server) {
  return {
    id: server.id,
    provider_id: server.providerId,
    name: server.name,
    address: server.address,
    remote_server_id: server.remoteServerId,
    remote_user_id: server.remoteUserId,
    user_name: server.userName,
    token: server.token,
    libraries: server.libraries.map(({ id, name, kind, selected }) => ({
      id,
      name,
      kind,
      selected
    })),
    enabled: server.enabled,
    use_catalog_metadata: server.useCatalogMetadata,
    import_watch_state: server.importWatchState
  };
}

export function parseSyncedServers(rows) {
  if (!Array.isArray(rows)) throw new Error("Invalid media server sync response");
  if (!rows.length) return null;
  if (!Array.isArray(rows[0]?.servers_json)) throw new Error("Invalid media server sync response");
  const result = rows[0].servers_json.map((raw) => {
    const address = normalizeMediaServerAddress(raw.address, raw.provider_id);
    if (
      !["jellyfin", "emby"].includes(raw.provider_id) ||
      !address ||
      ![raw.id, raw.remote_server_id, raw.remote_user_id, raw.token].every(
        (value) => typeof value === "string" && value
      ) ||
      !Array.isArray(raw.libraries)
    )
      throw new Error("Invalid media server sync payload");
    for (const flag of ["enabled", "use_catalog_metadata", "import_watch_state"]) {
      if (raw[flag] != null && typeof raw[flag] !== "boolean")
        throw new Error("Invalid media server sync flag");
    }
    const libraries = raw.libraries.map((library) => {
      if (
        typeof library.id !== "string" ||
        !library.id ||
        typeof library.name !== "string" ||
        !["movie", "series", "mixed", "collection"].includes(library.kind) ||
        typeof library.selected !== "boolean"
      )
        throw new Error("Invalid media server library payload");
      return { id: library.id, name: library.name, kind: library.kind, selected: library.selected };
    });
    return {
      id: raw.id,
      providerId: raw.provider_id,
      address,
      name: String(raw.name || ""),
      remoteServerId: raw.remote_server_id,
      remoteUserId: raw.remote_user_id,
      userName: String(raw.user_name || ""),
      token: raw.token,
      libraries,
      enabled: raw.enabled !== false,
      useCatalogMetadata: raw.use_catalog_metadata === true,
      importWatchState: typeof raw.import_watch_state === "boolean" ? raw.import_watch_state : null
    };
  });
  if (new Set(result.map(serverSyncKey)).size !== result.length)
    throw new Error("Duplicate media server sync identity");
  return result;
}

export function mergeSyncedServers(local, remote, syncedKeys) {
  const localByKey = new Map(local.map((server) => [serverSyncKey(server), server]));
  const remoteKeys = new Set(remote.map(serverSyncKey));
  const known = syncedKeys == null ? null : new Set(syncedKeys);
  const merged = remote.map((server) => {
    const old = localByKey.get(serverSyncKey(server));
    return {
      ...server,
      id: old?.id || server.id,
      importWatchState: server.importWatchState ?? old?.importWatchState ?? false,
      aioStreams: old?.aioStreams || false
    };
  });
  merged.push(
    ...local.filter(
      (server) =>
        !remoteKeys.has(serverSyncKey(server)) && (!known || !known.has(serverSyncKey(server)))
    )
  );
  const used = new Set();
  const localIds = new Map(local.map((server) => [server.id, serverSyncKey(server)]));
  return merged.map((server) => {
    const key = serverSyncKey(server);
    let id = server.id;
    if (used.has(id) || (localIds.has(id) && localIds.get(id) !== key)) {
      do {
        id = `server-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      } while (used.has(id) || localIds.has(id));
    }
    used.add(id);
    return { ...server, id };
  });
}
