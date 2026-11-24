import test from "node:test";
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};
const { PlayerSettingsStore } = await import("../js/data/local/playerSettingsStore.js");

const tolerance = () => PlayerSettingsStore.get().subtitleStyle.autoSyncToleranceMs;
const saveStyle = (style) =>
  PlayerSettingsStore.set(
    { subtitleStyle: { ...PlayerSettingsStore.get().subtitleStyle, ...style } },
    { silentSync: true }
  );

// Android AutoSyncPreferences.DEFAULT_SYNC_TOLERANCE_MS (be2f5dbdd).
test("AutoSync tolerance defaults to 300 ms", () => {
  assert.equal(PlayerSettingsStore.getDefaults().subtitleStyle.autoSyncToleranceMs, 300);
  assert.equal(tolerance(), 300);
});

test("the old stored 0 ms default moves to 300 ms, a picked value is kept", () => {
  saveStyle({ autoSyncToleranceMs: 0, autoSyncToleranceChosen: false });
  assert.equal(tolerance(), 300);
  saveStyle({ autoSyncToleranceMs: 0, autoSyncToleranceChosen: true });
  assert.equal(tolerance(), 0);
  saveStyle({ fontSize: 140 });
  assert.equal(tolerance(), 0, "a later settings write keeps the picked Off");
  saveStyle({ autoSyncToleranceMs: 100 });
  assert.equal(tolerance(), 100);
  saveStyle({ autoSyncToleranceMs: 250 });
  assert.equal(tolerance(), 300, "values outside the options fall back to the default");
});
