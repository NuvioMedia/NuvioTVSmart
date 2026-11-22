import assert from "node:assert/strict";
import test from "node:test";
import { P2pCacheService } from "./p2pCacheService.js";
import { resetTizenCapabilitiesCache } from "../../platform/tizen/tizenCapabilities.js";

function installTizenRuntime(platformVersion) {
  globalThis.__NUVIO_PLATFORM__ = "tizen";
  globalThis.tizen = {
    systeminfo: {
      getCapability(name) {
        return name.includes("platform.version") ? platformVersion : false;
      }
    }
  };
  resetTizenCapabilitiesCache();
}

test("P2pCacheService.supportsCacheControls follows the Tizen P2P capability", () => {
  const previousPlatform = globalThis.__NUVIO_PLATFORM__;
  const previousTizen = globalThis.tizen;
  try {
    installTizenRuntime("4.0");
    assert.equal(P2pCacheService.supportsCacheControls(), false);

    installTizenRuntime("5.0");
    assert.equal(P2pCacheService.supportsCacheControls(), true);
  } finally {
    if (previousPlatform === undefined) delete globalThis.__NUVIO_PLATFORM__;
    else globalThis.__NUVIO_PLATFORM__ = previousPlatform;
    if (previousTizen === undefined) delete globalThis.tizen;
    else globalThis.tizen = previousTizen;
    resetTizenCapabilitiesCache();
  }
});

test("P2pCacheService.supportsCacheControls stays disabled off Tizen", () => {
  const previousPlatform = globalThis.__NUVIO_PLATFORM__;
  const previousTizen = globalThis.tizen;
  try {
    globalThis.__NUVIO_PLATFORM__ = "webos";
    delete globalThis.tizen;
    resetTizenCapabilitiesCache();
    assert.equal(P2pCacheService.supportsCacheControls(), false);
  } finally {
    if (previousPlatform === undefined) delete globalThis.__NUVIO_PLATFORM__;
    else globalThis.__NUVIO_PLATFORM__ = previousPlatform;
    if (previousTizen === undefined) delete globalThis.tizen;
    else globalThis.tizen = previousTizen;
    resetTizenCapabilitiesCache();
  }
});
