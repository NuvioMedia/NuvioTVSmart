import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { isLowMemoryDevice } from "./tvPerformancePolicy.js";

function loadProfile({
  webos = false,
  tizenVersion = "",
  chromium = 0,
  memory = 0,
  measured = null,
  forced = null
}) {
  const source = readFileSync(new URL("./tvRuntimePerformance.js", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?;\n/gm, "")
    .replace(/^export /gm, "");
  return vm.runInNewContext(`${source}\n;({ getTvRuntimePerformanceProfile })`, {
    Platform: {
      isWebOS: () => webos,
      isTizen: () => !webos,
      getName: () => (webos ? "webos" : "tizen")
    },
    TizenCapabilities: { get: () => ({ tizenVersion, chromiumMajorVersion: chromium }) },
    navigator: { userAgent: `Mozilla/5.0 Chrome/${chromium}.0.0.0 Safari/537.36` },
    isLowMemoryDevice,
    readMeasuredTvTier: () => measured,
    readForcedTvTier: () => forced,
    getDeviceMemoryGb: () => memory
  }).getTvRuntimePerformanceProfile;
}

test("a modern TV with 1 GB of RAM is performance-constrained", () => {
  assert.equal(
    loadProfile({ tizenVersion: "9.0", chromium: 120, memory: 1 })().isPerformanceConstrained,
    true
  );
  assert.equal(
    loadProfile({ webos: true, chromium: 87, memory: 1 })().isPerformanceConstrained,
    true
  );
});

test("RAM does not downgrade a modern TV that reports 2 GB or more", () => {
  assert.equal(
    loadProfile({ tizenVersion: "9.0", chromium: 120, memory: 2 })().isPerformanceConstrained,
    false
  );
  assert.equal(
    loadProfile({ webos: true, chromium: 87, memory: 2 })().isPerformanceConstrained,
    false
  );
});

test("a modern TV measured slow is constrained without becoming a legacy runtime", () => {
  const profile = loadProfile({ tizenVersion: "7.0", chromium: 94, measured: "constrained" })();
  assert.equal(profile.isPerformanceConstrained, true);
  assert.equal(profile.isMeasuredSlow, true);
  assert.equal(profile.isLegacyTvRuntime, false);
});

test("the forced full tier drops the generation rule but not the measurement", () => {
  const forcedFull = loadProfile({ tizenVersion: "5.0", chromium: 63, forced: "full" })();
  assert.equal(forcedFull.isPerformanceConstrained, false);
  assert.equal(forcedFull.isLegacyTvRuntime, false);
  const measuredBack = loadProfile({
    tizenVersion: "5.0",
    chromium: 63,
    forced: "full",
    measured: "constrained"
  })();
  assert.equal(measuredBack.isPerformanceConstrained, true);
  assert.equal(
    loadProfile({ tizenVersion: "9.0", chromium: 120, forced: "constrained" })()
      .isPerformanceConstrained,
    true
  );
});
