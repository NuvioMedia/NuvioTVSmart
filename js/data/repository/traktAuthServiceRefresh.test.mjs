import assert from "node:assert/strict";
import test from "node:test";

globalThis.__NUVIO_ENV__ = {
  TRAKT_CLIENT_ID: "cid",
  TRAKT_CLIENT_SECRET: "csec"
};
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(String(k)) ? storage.get(String(k)) : null),
  setItem: (k, v) => storage.set(String(k), String(v)),
  removeItem: (k) => storage.delete(String(k))
};

const { TraktAuthStore } = await import("../local/traktAuthStore.js");
const { TraktAuthService } = await import("./traktAuthService.js");

test("TraktAuthService shares concurrent token refreshes per profile and recovers from corrupt stats cache JSON", async () => {
  const originalFetch = globalThis.fetch;
  let tokenCalls = 0;
  try {
    TraktAuthStore.saveToken(
      {
        access_token: "expired-token",
        refresh_token: "refresh-token-1",
        created_at: 1,
        expires_in: 60
      },
      "1"
    );

    globalThis.fetch = async (url) => {
      const target = String(url);
      if (target.includes("/oauth/token")) {
        tokenCalls += 1;
        await new Promise((r) => setTimeout(r, 25));
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              access_token: "fresh-token",
              refresh_token: "refresh-token-2",
              created_at: Math.floor(Date.now() / 1000),
              expires_in: 7200
            })
        };
      }
      if (target.includes("/users/settings")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ user: { username: "tester", ids: { slug: "me" } } })
        };
      }
      if (target.includes("/stats")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ movies: { watched: 17 } })
        };
      }
      return { ok: true, status: 200, text: async () => "{}" };
    };

    const [a, b] = await Promise.all([
      TraktAuthService.refreshTokenIfNeeded(true),
      TraktAuthService.refreshTokenIfNeeded(true)
    ]);
    assert.equal(a, true);
    assert.equal(b, true);
    assert.equal(tokenCalls, 1);

    globalThis.localStorage.setItem("traktCachedStats:me", "{corrupt-json");
    const stats = await TraktAuthService.fetchStats(false);
    assert.equal(stats?.moviesWatched, 17);
  } finally {
    globalThis.fetch = originalFetch;
    TraktAuthStore.clearAuth("1");
    storage.delete("traktCachedStats:me");
  }
});

test(
  "TraktAuthService finishes a refresh whose rotated token is already inside the refresh leeway",
  { timeout: 2000 },
  async () => {
    const originalFetch = globalThis.fetch;
    try {
      TraktAuthStore.saveToken(
        {
          access_token: "expired-token",
          refresh_token: "refresh-token-1",
          created_at: 1,
          expires_in: 60
        },
        "1"
      );

      globalThis.fetch = async (url) => {
        const target = String(url);
        if (target.includes("/oauth/token")) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                access_token: "fresh-token",
                refresh_token: "refresh-token-2",
                created_at: Math.floor(Date.now() / 1000),
                expires_in: 0
              })
          };
        }
        if (target.includes("/users/settings")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ user: { username: "tester", ids: { slug: "me" } } })
          };
        }
        return { ok: true, status: 200, text: async () => "{}" };
      };

      assert.equal(await TraktAuthService.refreshTokenIfNeeded(true), true);
    } finally {
      globalThis.fetch = originalFetch;
      TraktAuthStore.clearAuth("1");
    }
  }
);
