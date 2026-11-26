import assert from "node:assert/strict";
import test from "node:test";

const storageMap = new Map();
globalThis.localStorage = {
  getItem: (key) => (storageMap.has(String(key)) ? storageMap.get(String(key)) : null),
  setItem: (key, value) => storageMap.set(String(key), String(value)),
  removeItem: (key) => storageMap.delete(String(key)),
  key: (index) => Array.from(storageMap.keys())[index] ?? null,
  get length() {
    return storageMap.size;
  }
};

const sessionMap = new Map();
globalThis.sessionStorage = {
  getItem: (key) => (sessionMap.has(String(key)) ? sessionMap.get(String(key)) : null),
  setItem: (key, value) => sessionMap.set(String(key), String(value)),
  removeItem: (key) => sessionMap.delete(String(key)),
  key: (index) => Array.from(sessionMap.keys())[index] ?? null,
  get length() {
    return sessionMap.size;
  }
};

const { clearAccountLocalData } = await import("./accountLocalDataReset.js");
const { AuthManager } = await import("./authManager.js");
const { registerSessionTeardownHandler, trackSessionRequest } =
  await import("./sessionLifecycle.js");
const { isSyncBackoffActive, recordSyncFailure } = await import("../sync/syncBackoffPolicy.js");

test("signOut removes account-scoped caches including non-envelope keys and resets in-memory sync backoff", async () => {
  storageMap.clear();
  sessionMap.clear();

  const keysToClear = [
    "addonManifestCacheV2",
    "streamLinkCache",
    "lastPlaybackStream",
    "searchHistory",
    "subtitleDelayPreferences",
    "episodeShuffle",
    "pluginProviderPlays",
    "profileLockStateCache"
  ];
  for (const key of keysToClear) {
    storageMap.set(key, "legacy-or-plain-value");
  }
  storageMap.set(
    "torrentSettings",
    JSON.stringify({ __profileScoped: true, version: 1, profiles: { 1: {} } })
  );

  const recorded = recordSyncFailure({ status: 503, message: "Service unavailable" }, Date.now());
  assert.equal(recorded, true);
  assert.equal(isSyncBackoffActive(), true);

  await AuthManager.signOut();

  for (const key of keysToClear) {
    assert.equal(
      storageMap.has(key),
      false,
      `Expected signOut/clearAccountLocalData to remove ${key}`
    );
  }
  assert.equal(
    storageMap.has("torrentSettings"),
    true,
    "Device torrentSettings must remain preserved"
  );
  assert.equal(
    storageMap.has("nuvioSyncBackoffState"),
    false,
    "Stored sync backoff must be removed after signOut"
  );
  assert.equal(isSyncBackoffActive(), false, "In-memory sync backoff must be reset after signOut");

  // Also check direct clearAccountLocalData invocation explicitly.
  for (const key of keysToClear) {
    storageMap.set(key, "stale");
  }
  clearAccountLocalData();
  for (const key of keysToClear) {
    assert.equal(storageMap.has(key), false, `Expected clearAccountLocalData to remove ${key}`);
  }
});

test("signOut resets sync backoff after in-flight session requests drain", async () => {
  storageMap.clear();
  sessionMap.clear();

  recordSyncFailure({ status: 503, message: "Service unavailable" });
  assert.equal(isSyncBackoffActive(), true);

  const unregister = registerSessionTeardownHandler(() => {
    trackSessionRequest(
      new Promise((resolve) => {
        setTimeout(() => {
          recordSyncFailure({ status: 503, message: "Service unavailable" });
          resolve();
        }, 10);
      })
    );
  });

  try {
    await AuthManager.signOut();
  } finally {
    unregister();
  }

  assert.equal(storageMap.has("nuvioSyncBackoffState"), false);
  assert.equal(isSyncBackoffActive(), false);
});
