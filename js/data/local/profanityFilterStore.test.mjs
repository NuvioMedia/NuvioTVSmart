import test from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = {
  data: {},
  getItem(key) {
    return this.data[key] ?? null;
  },
  setItem(key, value) {
    this.data[key] = String(value);
  },
  removeItem(key) {
    delete this.data[key];
  }
};

const {
  normalizeProfanityFilterSettings,
  resolveProfanityFilterForTitle,
  shouldLookUpTitleRating
} = await import("./profanityFilterStore.js");

test("the filter is off by default and only filters titles switched on by hand", () => {
  const defaults = normalizeProfanityFilterSettings({});
  assert.equal(defaults.enabled, false);
  assert.equal(defaults.mode, "manual");
  assert.deepEqual(
    resolveProfanityFilterForTitle({ titleKey: "tt1", rating: "TV-MA", settings: defaults }),
    {
      enabled: false,
      reason: "disabled",
      rating: "TV-MA"
    }
  );
  const on = normalizeProfanityFilterSettings({ enabled: true });
  assert.equal(
    resolveProfanityFilterForTitle({ titleKey: "tt1", rating: "TV-MA", settings: on }).reason,
    "manual"
  );
  const withTitle = normalizeProfanityFilterSettings({
    enabled: true,
    titleOverrides: { tt1: { enabled: true, at: 1 } }
  });
  assert.equal(
    resolveProfanityFilterForTitle({ titleKey: "tt1:1:2", settings: withTitle }).enabled,
    true
  );
});

test("per-title choices do nothing while the filter is off", () => {
  const settings = normalizeProfanityFilterSettings({
    enabled: false,
    titleOverrides: { tt1: { enabled: true, at: 1 } }
  });
  assert.equal(resolveProfanityFilterForTitle({ titleKey: "tt1", settings }).enabled, false);
});

test("settings saved by earlier builds keep working", () => {
  assert.equal(normalizeProfanityFilterSettings({ mode: "rated" }).enabled, true);
  assert.equal(normalizeProfanityFilterSettings({ mode: "rated" }).mode, "rated");
  const off = normalizeProfanityFilterSettings({ mode: "off" });
  assert.equal(off.enabled, false);
  assert.equal(off.mode, "manual");
  assert.equal(normalizeProfanityFilterSettings({ maskStyle: "censor" }).maskStyle, "stars");
});

test("ratings are only looked up when they can change the outcome", () => {
  const rated = normalizeProfanityFilterSettings({ enabled: true, mode: "rated" });
  assert.equal(shouldLookUpTitleRating("tt1", rated), true);
  assert.equal(shouldLookUpTitleRating("tt1", normalizeProfanityFilterSettings({})), false);
  assert.equal(
    shouldLookUpTitleRating("tt1", normalizeProfanityFilterSettings({ enabled: true })),
    false
  );
  const chosen = normalizeProfanityFilterSettings({
    enabled: true,
    mode: "rated",
    titleOverrides: { tt1: { enabled: false, at: 1 } }
  });
  assert.equal(shouldLookUpTitleRating("tt1", chosen), false);
});
