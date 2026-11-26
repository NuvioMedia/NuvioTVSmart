import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";

class FakeClassList {
  constructor(el) {
    this.el = el;
    this.set = new Set();
  }
  add(...names) {
    names.filter(Boolean).forEach((name) => this.set.add(name));
  }
  remove(...names) {
    names.forEach((name) => this.set.delete(name));
  }
  toggle(name, force) {
    if (force === undefined) {
      if (this.set.has(name)) {
        this.set.delete(name);
        return false;
      }
      this.set.add(name);
      return true;
    }
    if (force) {
      this.set.add(name);
      return true;
    }
    this.set.delete(name);
    return false;
  }
  contains(name) {
    return this.set.has(name);
  }
}

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = String(tagName).toUpperCase();
    this.style = {};
    this.dataset = {};
    this.attributes = new Map();
    this.children = [];
    this.parentNode = null;
    this.parentElement = null;
    this.listeners = new Map();
    this.classList = new FakeClassList(this);
    this.textContent = "";
    this.innerHTML = "";
    this.value = "";
    this.disabled = false;
    this.offsetWidth = 100;
    this.isConnected = true;
    this.focused = false;
  }
  get className() {
    return Array.from(this.classList.set).join(" ");
  }
  set className(value) {
    this.classList.set = new Set(
      String(value || "")
        .split(/\s+/)
        .filter(Boolean)
    );
  }
  setAttribute(name, value) {
    const str = String(value);
    this.attributes.set(name, str);
    if (name.startsWith("data-")) {
      const camel = name.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
      this.dataset[camel] = str;
    }
  }
  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }
  appendChild(child) {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx >= 0) {
      this.children.splice(idx, 1);
      child.parentNode = null;
      child.parentElement = null;
    }
    return child;
  }
  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }
  focus() {
    this.focused = true;
    globalThis.document.activeElement = this;
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
  contains(node) {
    let cur = node;
    while (cur) {
      if (cur === this) {
        return true;
      }
      cur = cur.parentNode;
    }
    return false;
  }
}

const originalGlobals = {
  localStorage: globalThis.localStorage,
  document: globalThis.document,
  window: globalThis.window,
  requestAnimationFrame: globalThis.requestAnimationFrame,
  cancelAnimationFrame: globalThis.cancelAnimationFrame
};

const storageMap = new Map();
const fakeLocalStorage = {
  getItem(key) {
    return storageMap.has(String(key)) ? storageMap.get(String(key)) : null;
  },
  setItem(key, value) {
    storageMap.set(String(key), String(value));
  },
  removeItem(key) {
    storageMap.delete(String(key));
  },
  clear() {
    storageMap.clear();
  }
};

const fakeBody = new FakeElement("body");
const fakeContainer = new FakeElement("div");
const documentListeners = new Map();
const windowListeners = new Map();

globalThis.localStorage = fakeLocalStorage;
globalThis.document = {
  body: fakeBody,
  activeElement: null,
  getElementById(id) {
    return id === "profileSelection" ? fakeContainer : null;
  },
  createElement(tag) {
    return new FakeElement(tag);
  },
  querySelector() {
    return null;
  },
  querySelectorAll() {
    return [];
  },
  addEventListener(type, listener) {
    if (!documentListeners.has(type)) {
      documentListeners.set(type, new Set());
    }
    documentListeners.get(type).add(listener);
  },
  removeEventListener(type, listener) {
    documentListeners.get(type)?.delete(listener);
  }
};
globalThis.window = {
  localStorage: fakeLocalStorage,
  location: { origin: "http://localhost", href: "http://localhost/" },
  addEventListener(type, listener) {
    if (!windowListeners.has(type)) {
      windowListeners.set(type, new Set());
    }
    windowListeners.get(type).add(listener);
  },
  removeEventListener(type, listener) {
    windowListeners.get(type)?.delete(listener);
  }
};
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};

const { AuthManager } = await import("../auth/authManager.js");
const { AuthState } = await import("../auth/authState.js");
const { LocalStore } = await import("../storage/localStore.js");
const { SupabaseApi } = await import("../../data/remote/supabase/supabaseApi.js");
const { recordSyncFailure, resetSyncBackoff } = await import("../sync/syncBackoffPolicy.js");
const { ProfileSyncService } = await import("./profileSyncService.js");
const { ProfileManager } = await import("./profileManager.js");
const { MemberAccessRepository } =
  await import("../../data/remote/supabase/memberAccessRepository.js");
const { ProfileBackgroundRepository } =
  await import("../../data/remote/supabase/profileBackgroundRepository.js");
const { I18n } = await import("../../i18n/index.js");
const { ProfileSelectionScreen } = await import("./profileSelectionScreen.js");

const originals = {
  authState: AuthManager.getAuthState(),
  rpc: SupabaseApi.rpc,
  pullProfiles: ProfileSyncService.pull,
  getProfiles: ProfileManager.getProfiles,
  getActiveProfileId: ProfileManager.getActiveProfileId,
  getCurrentAccess: MemberAccessRepository.getCurrentAccess,
  subscribeAccess: MemberAccessRepository.subscribe,
  subscribeBg: ProfileBackgroundRepository.subscribe,
  i18nT: I18n.t
};

const sampleProfiles = [
  { id: "1", profileIndex: 1, name: "Main", avatarColorHex: "#1E88E5", isPrimary: true },
  { id: "2", profileIndex: 2, name: "Kids", avatarColorHex: "#E53935", isPrimary: false }
];

beforeEach(() => {
  fakeLocalStorage.clear();
  resetSyncBackoff();
  AuthManager.setState(AuthState.AUTHENTICATED);
  fakeBody.children = [];
  fakeContainer.innerHTML = "";
  fakeContainer.style = {};

  SupabaseApi.rpc = originals.rpc;
  ProfileSyncService.pull = async () => [];
  ProfileManager.getProfiles = async () => sampleProfiles.map((profile) => ({ ...profile }));
  ProfileManager.getActiveProfileId = () => "1";
  MemberAccessRepository.getCurrentAccess = () => ({ active: false, entitlements: [] });
  MemberAccessRepository.subscribe = () => () => {};
  ProfileBackgroundRepository.subscribe = () => () => {};
  I18n.t = (_key, _params, options) => options?.fallback ?? _key;
});

after(() => {
  ProfileSelectionScreen.cleanup();
  resetSyncBackoff();
  AuthManager.setState(originals.authState);
  SupabaseApi.rpc = originals.rpc;
  ProfileSyncService.pull = originals.pullProfiles;
  ProfileManager.getProfiles = originals.getProfiles;
  ProfileManager.getActiveProfileId = originals.getActiveProfileId;
  MemberAccessRepository.getCurrentAccess = originals.getCurrentAccess;
  MemberAccessRepository.subscribe = originals.subscribeAccess;
  ProfileBackgroundRepository.subscribe = originals.subscribeBg;
  I18n.t = originals.i18nT;

  for (const [key, value] of Object.entries(originalGlobals)) {
    if (value === undefined) {
      delete globalThis[key];
    } else {
      globalThis[key] = value;
    }
  }
});

test("pullProfileLockStates returns cached lock states during sync backoff when authenticated, and empty when signed out", async () => {
  LocalStore.set("profileLockStateCache", { 1: true, 2: false });
  recordSyncFailure({ status: 503, message: "Service Unavailable" });

  let rpcCalls = 0;
  SupabaseApi.rpc = async () => {
    rpcCalls += 1;
    return [];
  };

  const backoffStates = await ProfileSyncService.pullProfileLockStates();
  assert.deepEqual(backoffStates, { 1: true, 2: false });
  assert.equal(rpcCalls, 0, "must not hit Supabase RPC while sync backoff is active");

  // Returned map must be a copy so caller mutations cannot corrupt LocalStore cache.
  backoffStates["1"] = false;
  assert.deepEqual(ProfileSyncService.getCachedProfileLockStates(), { 1: true, 2: false });

  // Signed-out sessions must never receive stale cached lock states even during backoff.
  AuthManager.setState(AuthState.SIGNED_OUT);
  const signedOutStates = await ProfileSyncService.pullProfileLockStates();
  assert.deepEqual(signedOutStates, {});
  assert.equal(rpcCalls, 0);
});

test("pullProfileLockStates falls back to cached lock states when RPC fails, and updates cache on live response", async () => {
  LocalStore.set("profileLockStateCache", { 1: true, 2: false });

  SupabaseApi.rpc = async () => {
    throw Object.assign(new Error("HTTP 503"), { status: 503 });
  };

  const fallbackStates = await ProfileSyncService.pullProfileLockStates();
  assert.deepEqual(fallbackStates, { 1: true, 2: false });
  assert.deepEqual(ProfileSyncService.getCachedProfileLockStates(), { 1: true, 2: false });

  // Without any cached lock state yet, failure still returns an empty map.
  ProfileSyncService.clearCachedProfileLockStates();
  const uncachedFallback = await ProfileSyncService.pullProfileLockStates();
  assert.deepEqual(uncachedFallback, {});
  assert.equal(ProfileSyncService.getCachedProfileLockStates(), null);

  // Once the server answers, live lock states overwrite the cache and are returned.
  SupabaseApi.rpc = async (rpcName) => {
    assert.equal(rpcName, "sync_pull_profile_locks");
    return [
      { profile_index: 1, pin_enabled: false },
      { profile_index: 2, pin_enabled: true }
    ];
  };

  const liveStates = await ProfileSyncService.pullProfileLockStates();
  assert.deepEqual(liveStates, { 1: false, 2: true });
  assert.deepEqual(ProfileSyncService.getCachedProfileLockStates(), { 1: false, 2: true });
});

test("ProfileSelectionScreen.mount seeds profilePinEnabled from cache immediately and preserves locks when sync fails or backs off", async () => {
  LocalStore.set("profileLockStateCache", { 1: true, 2: false });

  let resolveProfilePull;
  ProfileSyncService.pull = () =>
    new Promise((resolve) => {
      resolveProfilePull = resolve;
    });
  SupabaseApi.rpc = async () => {
    throw new Error("Failed to fetch");
  };

  await ProfileSelectionScreen.mount({ mode: "management" });

  // Immediately after mount (before initialProfileSync finishes), cached lock states apply.
  assert.equal(
    ProfileSelectionScreen.isProfilePinEnabled("1"),
    true,
    "locked profile must be known before initialProfileSync resolves"
  );
  assert.equal(ProfileSelectionScreen.isProfilePinEnabled("2"), false);

  resolveProfilePull([]);
  await ProfileSelectionScreen.initialProfileSync;

  // Even after sync_pull_profile_locks fails, cached lock state is preserved (not wiped to {}).
  assert.equal(
    ProfileSelectionScreen.isProfilePinEnabled("1"),
    true,
    "transient pull failure must not erase cached PIN lock state"
  );
  assert.equal(ProfileSelectionScreen.isProfilePinEnabled("2"), false);

  // Profile Options must still advertise Change PIN / Remove PIN rather than Set PIN.
  await ProfileSelectionScreen.openOptionsDialog(sampleProfiles[0]);
  const optionKeys = ProfileSelectionScreen._optionsDialog.buttons.map((btn) => btn.key);
  const pinButton = ProfileSelectionScreen._optionsDialog.buttons.find((btn) => btn.key === "pin");
  assert.equal(pinButton?.label, "Change PIN");
  assert.equal(optionKeys.includes("remove-pin"), true);

  // Refreshing PIN states while sync backoff is active must also preserve cached locks.
  recordSyncFailure({ status: 503, message: "Service Unavailable" });
  await ProfileSelectionScreen.refreshProfilePinStates();
  assert.equal(ProfileSelectionScreen.isProfilePinEnabled("1"), true);

  ProfileSelectionScreen.cleanup();
  // Drain NuvioDialog's 180ms backdrop teardown timer before finishing the test.
  await new Promise((resolve) => setTimeout(resolve, 220));
});

test("ProfileSelectionScreen.mount applies live server lock changes once initial sync succeeds", async () => {
  LocalStore.set("profileLockStateCache", { 1: true, 2: false });

  SupabaseApi.rpc = async () => [
    { profile_index: 1, pin_enabled: false },
    { profile_index: 2, pin_enabled: true }
  ];

  await ProfileSelectionScreen.mount({ mode: "selection" });
  assert.equal(ProfileSelectionScreen.isProfilePinEnabled("1"), true);

  await ProfileSelectionScreen.initialProfileSync;
  assert.equal(ProfileSelectionScreen.isProfilePinEnabled("1"), false);
  assert.equal(ProfileSelectionScreen.isProfilePinEnabled("2"), true);

  ProfileSelectionScreen.cleanup();
});
