import { test } from "node:test";
import assert from "node:assert/strict";

import {
  getArtworkCacheLimit,
  getArtworkEvictIdleMs,
  getArtworkEvictMarginPx,
  getTrailerCleanupDelayMs,
  getTrailerMountGraceMs,
  isModernTvProfile
} from "./tvPerformancePolicy.js";

const modern = { isTvRuntime: true, isPerformanceConstrained: false, isLegacyTvRuntime: false };
const constrained = { isTvRuntime: true, isPerformanceConstrained: true, isLegacyTvRuntime: true };
const legacyOnly = { isTvRuntime: true, isPerformanceConstrained: false, isLegacyTvRuntime: true };
const browser = { isTvRuntime: false, isPerformanceConstrained: false, isLegacyTvRuntime: false };

test("modern TVs keep a wider artwork window and defer eviction", () => {
  assert.equal(isModernTvProfile(modern), true);
  assert.equal(getArtworkEvictIdleMs(modern), 1200);
  assert.equal(getArtworkEvictMarginPx(modern), 2600);
});

test("constrained and legacy TV generations keep today's aggressive release", () => {
  for (const profile of [constrained, legacyOnly, browser, null]) {
    assert.equal(isModernTvProfile(profile), false);
    assert.equal(getArtworkEvictIdleMs(profile), 0);
    assert.equal(getArtworkEvictMarginPx(profile), 1600);
    assert.equal(getTrailerCleanupDelayMs(profile), 900);
    assert.equal(getTrailerMountGraceMs(profile), 0);
  }
});

test("modern TVs get the larger artwork cache; low-RAM TVs keep the smallest", () => {
  assert.equal(getArtworkCacheLimit(modern, 4), 640);
  assert.equal(getArtworkCacheLimit(constrained, 4), 320);
  assert.equal(getArtworkCacheLimit(browser, 2), 320);
  // RAM decides before the generation: a modern 1 GB set gets the low tier.
  assert.equal(getArtworkCacheLimit(modern, 1), 200);
  assert.equal(getArtworkCacheLimit(constrained, 1), 200);
});

test("a modern TV with 1 GB RAM uses the legacy eviction window", () => {
  assert.equal(getArtworkEvictIdleMs(modern, 1), 0);
  assert.equal(getArtworkEvictMarginPx(modern, 1), 1600);
  // Without the Device Memory API the profile alone still decides.
  assert.equal(getArtworkEvictIdleMs(modern, 0), 1200);
  assert.equal(getArtworkEvictMarginPx(modern, 0), 2600);
});
