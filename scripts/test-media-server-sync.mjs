import test from "node:test";
import assert from "node:assert/strict";
import { parseSyncedServers, toSyncedServer } from "../js/data/mediaserver/mediaServerSyncModel.js";

function syncedServer(overrides = {}) {
  return {
    id: "connection",
    provider_id: "jellyfin",
    name: "Test server",
    address: "https://server.test",
    remote_server_id: "server",
    remote_user_id: "user",
    user_name: "Test user",
    token: "fixture-token",
    libraries: [{ id: "movies", name: "Movies", kind: "movie", selected: true }],
    enabled: true,
    use_catalog_metadata: false,
    import_watch_state: true,
    ...overrides
  };
}

test("imports the canonical servers_json cloud response", () => {
  const servers = [syncedServer(), syncedServer({ provider_id: "emby", id: "emby-connection" })];
  const imported = parseSyncedServers([{ servers_json: servers, updated_at: "2026-01-01" }]);
  assert.deepEqual(imported.map(toSyncedServer), servers);
  assert.deepEqual(parseSyncedServers([{ servers_json: [] }]), []);
  assert.equal(parseSyncedServers([]), null);
});

test("rejects malformed envelopes, including the obsolete servers field", () => {
  const rows = [null, {}, [null], [{}], [{ servers: [syncedServer()] }], [{ servers: [] }]];
  for (const row of rows) {
    assert.throws(() => parseSyncedServers(row), /Invalid media server sync response/);
  }
  for (const servers_json of [null, {}, "[]", false, 0]) {
    assert.throws(
      () => parseSyncedServers([{ servers_json }]),
      /Invalid media server sync response/
    );
  }
});

test("preserves connection, library, flag and duplicate identity validation", () => {
  const invalid = [
    { provider_id: "unknown" },
    { address: "https://user:password@server.test" },
    { address: "https://server.test?token=fixture" },
    { address: "file:///server" },
    ...["id", "remote_server_id", "remote_user_id", "token"].map((key) => ({ [key]: "" })),
    { libraries: null },
    ...[{ id: "" }, { name: null }, { kind: "unknown" }, { selected: "true" }].map((library) => ({
      libraries: [{ ...syncedServer().libraries[0], ...library }]
    })),
    ...["enabled", "use_catalog_metadata", "import_watch_state"].map((key) => ({ [key]: "true" }))
  ];
  for (const overrides of invalid) {
    assert.throws(() => parseSyncedServers([{ servers_json: [syncedServer(overrides)] }]));
  }
  assert.throws(() => parseSyncedServers([{ servers_json: [null] }]));
  assert.throws(
    () =>
      parseSyncedServers([{ servers_json: [syncedServer(), syncedServer({ id: "duplicate" })] }]),
    /Duplicate media server sync identity/
  );
});
