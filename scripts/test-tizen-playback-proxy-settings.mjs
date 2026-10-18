import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  get length() {
    return storage.size;
  },
  key: (index) => [...storage.keys()][index] ?? null,
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear()
};

const { TizenPlaybackSettingsStore } =
  await import("../js/data/local/tizenPlaybackSettingsStore.js");
const { clearAccountLocalData } = await import("../js/core/auth/accountLocalDataReset.js");
const { Platform } = await import("../js/platform/index.js");
const { Router } = await import("../js/ui/navigation/routerState.js");
const { createSettingsScreenMethods01 } =
  await import("../js/ui/screens/settings/settingsScreenMethods-01-get-current-rail-scroll-top.js");
const { createSettingsScreenMethods02 } =
  await import("../js/ui/screens/settings/settingsScreenMethods-02-render-action-row.js");
const { createSettingsScreenMethods05 } =
  await import("../js/ui/screens/settings/settingsScreenMethods-05-render-advanced-section.js");
const { createSettingsScreenMethods14 } =
  await import("../js/ui/screens/settings/settingsScreenMethods-14-activate-focused.js");

const KEY = "tizenPlaybackSettings";
const FOCUS_KEY = "advanced:alwaysUsePlaybackProxy";

// A fresh install and malformed persisted values must leave automatic routing on.
assert.deepEqual(TizenPlaybackSettingsStore.get(), { alwaysUsePlaybackProxy: false });
for (const invalid of [
  null,
  {},
  [],
  "true",
  { alwaysUsePlaybackProxy: "true" },
  { alwaysUsePlaybackProxy: 1 }
]) {
  localStorage.setItem(KEY, JSON.stringify(invalid));
  assert.equal(TizenPlaybackSettingsStore.get().alwaysUsePlaybackProxy, false);
}
TizenPlaybackSettingsStore.set({ alwaysUsePlaybackProxy: true, ignored: "not saved" });
assert.deepEqual(JSON.parse(localStorage.getItem(KEY)), { alwaysUsePlaybackProxy: true });
assert.equal(TizenPlaybackSettingsStore.set({}).alwaysUsePlaybackProxy, true);

// Reload the module: the choice is persisted, without a per-profile key.
const reloaded = await import("../js/data/local/tizenPlaybackSettingsStore.js?reload-test");
assert.equal(reloaded.TizenPlaybackSettingsStore.get().alwaysUsePlaybackProxy, true);
localStorage.setItem("activeProfileId", JSON.stringify("another-profile"));
assert.equal(reloaded.TizenPlaybackSettingsStore.get().alwaysUsePlaybackProxy, true);
clearAccountLocalData(localStorage);
assert.equal(localStorage.getItem("activeProfileId"), null);
assert.equal(reloaded.TizenPlaybackSettingsStore.get().alwaysUsePlaybackProxy, true);
TizenPlaybackSettingsStore.set({ alwaysUsePlaybackProxy: false });

let currentPlatform = "tizen";
Platform.isTizen = () => currentPlatform === "tizen";
Platform.isWebOS = () => currentPlatform === "webos";
Platform.isBackEvent = () => false;
Router.getCurrent = () => "settings";

function createScreen(mode = "ADVANCED") {
  const focused = { dataset: { focusKey: FOCUS_KEY, role: "toggle", zone: "content" } };
  return {
    ...createSettingsScreenMethods02(),
    ...createSettingsScreenMethods05(),
    ...createSettingsScreenMethods14(),
    registerAction: createSettingsScreenMethods01().registerAction,
    actionMap: new Map(),
    focusZone: "content",
    model: { experience: { mode }, fastHorizontalNavigation: false },
    renderSectionHeader: () => "",
    rememberAppearanceThemeFocusKey() {},
    container: { querySelector: () => focused },
    applyFocus() {
      this.focusApplied = true;
    },
    async render() {
      this.actionMap.clear();
      this.html = this.renderAdvancedSection(this.model);
    }
  };
}

// Reuse the real row renderer and action registration; other platforms and
// Essential mode keep their existing settings surfaces.
for (const platform of ["tizen", "webos", "browser"]) {
  currentPlatform = platform;
  for (const mode of ["ADVANCED", "ESSENTIAL"]) {
    const screen = createScreen(mode);
    await screen.render();
    const expected = platform === "tizen" && mode === "ADVANCED";
    assert.equal(screen.html.includes(`data-focus-key="${FOCUS_KEY}"`), expected);
    assert.equal(screen.actionMap.has(FOCUS_KEY), expected);
  }
}

// Exercise the normal remote OK / Enter activation path and its rerender.
currentPlatform = "tizen";
const screen = createScreen();
await screen.render();
let prevented = false;
await screen.onKeyDown({
  keyCode: 13,
  key: "Enter",
  preventDefault() {
    prevented = true;
  }
});
assert.equal(prevented, true);
assert.equal(TizenPlaybackSettingsStore.get().alwaysUsePlaybackProxy, true);
assert.equal(screen.contentFocusKey, FOCUS_KEY);
assert.equal(screen.focusApplied, true);
assert.equal(screen.suppressNextContentFocusScroll, true);
const proxyRow = screen.html.split(`data-focus-key="${FOCUS_KEY}"`)[1].split("</button>")[0];
assert.match(proxyRow, /settings-toggle-pill is-checked/);
assert.match(proxyRow, /Applies to the next stream/);
await screen.onKeyDown({ keyCode: 23, key: "OK", preventDefault() {} });
assert.equal(TizenPlaybackSettingsStore.get().alwaysUsePlaybackProxy, false);

console.log(
  "Tizen playback proxy settings: persistence, strict defaults, platform visibility, and remote activation passed"
);
