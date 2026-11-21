import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

const originalLocalStorage = globalThis.localStorage;
const store = new Map();

function resetMemoryLocalStorage() {
  store.clear();
  globalThis.localStorage = {
    get length() {
      return store.size;
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
    getItem: (key) => (store.has(String(key)) ? store.get(String(key)) : null),
    setItem: (key, value) => store.set(String(key), String(value)),
    removeItem: (key) => store.delete(String(key)),
    clear: () => store.clear()
  };
}

resetMemoryLocalStorage();

const { LocalStore } = await import("../storage/localStore.js");
const { clearAccountLocalData } = await import("./accountLocalDataReset.js");
const { AuthManager } = await import("./authManager.js");
const { AuthState } = await import("./authState.js");

beforeEach(() => {
  resetMemoryLocalStorage();
});

after(() => {
  globalThis.localStorage = originalLocalStorage;
});

test("clearAccountLocalData removes account keys and bumps LocalStore revisions", () => {
  LocalStore.set("installedAddonUrls", {
    __profileScoped: true,
    version: 1,
    profiles: { 1: ["https://private.addon.example/manifest.json"] }
  });
  LocalStore.set("mdbListTracking", { 1: { watched: ["tt123"] } });
  LocalStore.set("profiles", [{ id: "1", name: "User A" }]);

  const beforeAddonRev = LocalStore.revision("installedAddonUrls");
  const beforeMdbRev = LocalStore.revision("mdbListTracking");
  const beforeProfilesRev = LocalStore.revision("profiles");

  clearAccountLocalData();

  assert.equal(LocalStore.get("installedAddonUrls"), null);
  assert.equal(LocalStore.get("mdbListTracking"), null);
  assert.equal(LocalStore.get("profiles"), null);
  assert.ok(LocalStore.revision("installedAddonUrls") > beforeAddonRev);
  assert.ok(LocalStore.revision("mdbListTracking") > beforeMdbRev);
  assert.ok(LocalStore.revision("profiles") > beforeProfilesRev);
});

test("clearAccountLocalData targets custom storage without mutating globalThis.localStorage", () => {
  LocalStore.set("installedAddonUrls", ["https://global.example/manifest.json"]);
  const globalRevBefore = LocalStore.revision("installedAddonUrls");

  const customBacking = new Map([
    ["installedAddonUrls", JSON.stringify(["https://custom.example/manifest.json"])],
    ["torrentSettings", JSON.stringify({ __profileScoped: true, version: 1, profiles: { 1: {} } })]
  ]);
  const customStorage = {
    get length() {
      return customBacking.size;
    },
    key: (index) => Array.from(customBacking.keys())[index] ?? null,
    getItem: (key) => (customBacking.has(key) ? customBacking.get(key) : null),
    setItem: (key, value) => customBacking.set(key, String(value)),
    removeItem: (key) => customBacking.delete(key)
  };

  clearAccountLocalData(customStorage, null);

  assert.equal(customBacking.has("installedAddonUrls"), false);
  assert.equal(customBacking.has("torrentSettings"), true);
  assert.deepEqual(LocalStore.get("installedAddonUrls"), ["https://global.example/manifest.json"]);
  assert.equal(LocalStore.revision("installedAddonUrls"), globalRevBefore);
});

test("AuthManager.signOut clears account storage and bumps revisions before emitting SIGNED_OUT", async () => {
  LocalStore.set("installedAddonUrls", ["https://private-user-a.example/manifest.json"]);
  const revBefore = LocalStore.revision("installedAddonUrls");
  AuthManager.setState(AuthState.AUTHENTICATED);

  let observedAddonsOnSignOut = "unset";
  let observedRevisionOnSignOut = -1;
  const unsubscribe = AuthManager.subscribe((state) => {
    if (state === AuthState.SIGNED_OUT) {
      observedAddonsOnSignOut = LocalStore.get("installedAddonUrls");
      observedRevisionOnSignOut = LocalStore.revision("installedAddonUrls");
    }
  });

  try {
    await AuthManager.signOut();
    assert.equal(observedAddonsOnSignOut, null);
    assert.ok(observedRevisionOnSignOut > revBefore);
  } finally {
    unsubscribe();
  }
});
