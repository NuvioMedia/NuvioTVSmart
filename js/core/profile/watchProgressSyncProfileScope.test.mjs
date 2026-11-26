import assert from "node:assert/strict";
import test from "node:test";

globalThis.__NUVIO_ENV__ = {
  NUVIO_SUPABASE_URL: "https://primary.supabase.co",
  NUVIO_SUPABASE_ANON_KEY: "anon-key"
};
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(String(k)) ? storage.get(String(k)) : null),
  setItem: (k, v) => storage.set(String(k), String(v)),
  removeItem: (k) => storage.delete(String(k))
};

const { AuthState } = await import("../auth/authState.js");
const { AuthManager } = await import("../auth/authManager.js");
const { SessionStore } = await import("../storage/sessionStore.js");
const { ProfileManager } = await import("./profileManager.js");
const { TraktAuthStore } = await import("../../data/local/traktAuthStore.js");
const { WatchProgressSyncService } = await import("./watchProgressSyncService.js");
const { WatchedItemsSyncService } = await import("./watchedItemsSyncService.js");

test("WatchProgressSyncService and WatchedItemsSyncService evaluate gating and push locks per profileId", async () => {
  const originalFetch = globalThis.fetch;
  const originalState = AuthManager.state;
  const rpcCalls = [];
  try {
    AuthManager.state = AuthState.AUTHENTICATED;
    SessionStore.accessToken = "jwt-test-token";
    await ProfileManager.replaceProfiles([
      { id: "1", name: "Profile 1" },
      { id: "2", name: "Profile 2" }
    ]);
    await ProfileManager.setActiveProfile("1");

    // Profile 1 uses Trakt; Profile 2 has no Trakt/Simkl/MDBList connected and must sync via Supabase.
    TraktAuthStore.saveToken(
      {
        access_token: "t1",
        refresh_token: "r1",
        created_at: Math.floor(Date.now() / 1000),
        expires_in: 3600
      },
      "1"
    );
    TraktAuthStore.clearAuth("2");

    globalThis.fetch = async (url, init = {}) => {
      const target = String(url);
      if (target.includes("/rest/v1/rpc/")) {
        const rpcName = target.split("/rest/v1/rpc/")[1];
        const body = init.body ? JSON.parse(init.body) : {};
        rpcCalls.push({ rpcName, body });
        if (rpcName.includes("push") && body.p_profile_id === 1) {
          await new Promise((r) => setTimeout(r, 30));
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          text: async () => "[]"
        };
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        text: async () => "[]"
      };
    };

    const pulled2 = await WatchProgressSyncService.pull(2);
    assert.deepEqual(pulled2, []);
    assert.equal(WatchProgressSyncService.getLastPullStatus(), "ok");
    assert.equal(
      rpcCalls.some((c) => c.rpcName === "sync_pull_watch_progress" && c.body.p_profile_id === 2),
      true
    );

    rpcCalls.length = 0;
    const watchedPulled2 = await WatchedItemsSyncService.pull(2);
    assert.equal(
      rpcCalls.some((c) => c.rpcName === "sync_pull_watched_items" && c.body.p_profile_id === 2),
      true
    );
    assert.ok(Array.isArray(watchedPulled2));

    // Profile 1 still skips Supabase pull because Trakt is connected for profile 1.
    rpcCalls.length = 0;
    await WatchProgressSyncService.pull(1);
    assert.equal(WatchProgressSyncService.getLastPullStatus(), "skipped");
    assert.equal(rpcCalls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    AuthManager.state = originalState;
    TraktAuthStore.clearAuth("1");
  }
});
