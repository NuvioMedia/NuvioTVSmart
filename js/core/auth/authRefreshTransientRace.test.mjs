import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

const originalLocalStorage = globalThis.localStorage;
const originalFetch = globalThis.fetch;

function makeMemoryStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(String(key)) ? store.get(String(key)) : null),
    setItem: (key, value) => store.set(String(key), String(value)),
    removeItem: (key) => store.delete(String(key)),
    clear: () => store.clear(),
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    }
  };
}

function createJwt(expOffsetSeconds = 3600) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + expOffsetSeconds;
  const payload = Buffer.from(JSON.stringify({ sub: "user-123", exp })).toString("base64url");
  return `${header}.${payload}.signature`;
}

function makeResponse(status, body = {}, headers = {}) {
  const headerMap = new Map(
    Object.entries(headers).map(([k, v]) => [String(k).toLowerCase(), String(v)])
  );
  const textBody = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => headerMap.get(String(name || "").toLowerCase()) ?? null
    },
    text: async () => textBody,
    json: async () => (typeof body === "string" ? JSON.parse(body) : body)
  };
}

globalThis.__NUVIO_ENV__ = {
  NUVIO_SUPABASE_URL: "https://primary.supabase.co",
  NUVIO_SUPABASE_FALLBACK_URL: "https://primary.supabase.co",
  NUVIO_SUPABASE_ANON_KEY: "anon-key"
};
globalThis.localStorage = makeMemoryStorage();

const { AuthManager } = await import("./authManager.js");
const { SessionStore } = await import("../storage/sessionStore.js");
const { AuthState } = await import("./authState.js");
const { httpRequest, resetHttpClientBackendCooldownForTests } =
  await import("../network/httpClient.js");

let originalSignOut;

beforeEach(() => {
  globalThis.localStorage = makeMemoryStorage();
  resetHttpClientBackendCooldownForTests();
  SessionStore.accessToken = createJwt(3600);
  SessionStore.refreshToken = "refresh-token-1";
  AuthManager.lastRefreshFailureKind = null;
  AuthManager.refreshPromise = null;
  AuthManager.state = AuthState.AUTHENTICATED;
  originalSignOut = AuthManager.signOut.bind(AuthManager);
});

afterEach(() => {
  AuthManager.signOut = originalSignOut;
  AuthManager.lastRefreshFailureKind = null;
  AuthManager.refreshPromise = null;
  globalThis.fetch = originalFetch;
  globalThis.localStorage = originalLocalStorage;
});

test("no-op refreshSessionIfNeeded check preserves transient failure flag so concurrent 401 does not sign out or retry with stale token", async () => {
  let signOutCalls = 0;
  AuthManager.signOut = async (...args) => {
    signOutCalls += 1;
    return originalSignOut(...args);
  };

  let resource401Calls = 0;
  let refreshCalls = 0;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/auth/v1/token?grant_type=refresh_token")) {
      refreshCalls += 1;
      return makeResponse(503, { message: "upstream unavailable" });
    }
    resource401Calls += 1;
    return makeResponse(401, { message: "jwt rejected" });
  };

  // Forced refresh fails transiently while local JWT is unexpired.
  const refreshed = await AuthManager.refreshSessionIfNeeded({ force: true });
  assert.equal(refreshed, true);
  assert.equal(refreshCalls, 1);
  assert.equal(AuthManager.wasLastSessionRefreshTransientFailure(), true);

  // A concurrent non-forced check takes the valid-JWT early return and must NOT clear transient state.
  const noopOk = await AuthManager.refreshSessionIfNeeded();
  assert.equal(noopOk, true);
  assert.equal(refreshCalls, 1);
  assert.equal(
    AuthManager.wasLastSessionRefreshTransientFailure(),
    true,
    "non-forced early return must preserve lastRefreshFailureKind"
  );

  // A 401 request facing the same transient refresh failure must reject with 401 without signing out
  // and without issuing a redundant retry using the unchanged rejected access token.
  await assert.rejects(
    httpRequest("https://primary.supabase.co/rest/v1/profiles", { timeoutMs: 0 }),
    (error) => error?.status === 401
  );
  assert.equal(signOutCalls, 0, "transient refresh failure must not trigger signOut");
  assert.equal(resource401Calls, 1, "401 must not retry when refresh failed transiently");
  assert.equal(refreshCalls, 2);
});

test("subsequent forced refresh clears transient state on 200 and still signs out on invalid_grant", async () => {
  const updatedJwt = createJwt(7200);
  let signOutCalls = 0;
  AuthManager.signOut = async () => {
    signOutCalls += 1;
    SessionStore.clear?.();
    AuthManager.state = AuthState.SIGNED_OUT;
  };

  let mode = "transient";
  globalThis.fetch = async (url) => {
    if (String(url).includes("/auth/v1/token?grant_type=refresh_token")) {
      if (mode === "transient") {
        return makeResponse(502, { message: "bad gateway" });
      }
      if (mode === "ok") {
        return makeResponse(200, {
          access_token: updatedJwt,
          refresh_token: "refresh-token-2"
        });
      }
      return makeResponse(400, {
        error: "invalid_grant",
        error_description: "Invalid Refresh Token: Already Used"
      });
    }
    return makeResponse(200, { ok: true });
  };

  await AuthManager.refreshSessionIfNeeded({ force: true });
  assert.equal(AuthManager.wasLastSessionRefreshTransientFailure(), true);

  mode = "ok";
  const ok = await AuthManager.refreshSessionIfNeeded({ force: true });
  assert.equal(ok, true);
  assert.equal(AuthManager.wasLastSessionRefreshTransientFailure(), false);
  assert.equal(SessionStore.accessToken, updatedJwt);
  assert.equal(SessionStore.refreshToken, "refresh-token-2");
  assert.equal(signOutCalls, 0);

  mode = "invalid";
  const afterInvalid = await AuthManager.refreshSessionIfNeeded({ force: true });
  assert.equal(afterInvalid, false);
  assert.equal(AuthManager.wasLastSessionRefreshTransientFailure(), false);
  assert.equal(signOutCalls, 1, "invalid_grant must still sign out");
});
