import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

let importCounter = 0;

async function loadPlatformWithEnv({
  userAgent = "",
  palmDeviceInfo = "",
  webosDeviceInfo = "",
  platformOverride = "webos"
} = {}) {
  const prevNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const prevPalmSystem = globalThis.PalmSystem;
  const prevWebOSSystem = globalThis.webOSSystem;
  const prevOverride = globalThis.__NUVIO_PLATFORM__;

  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent },
    configurable: true
  });
  if (palmDeviceInfo) {
    globalThis.PalmSystem = { deviceInfo: palmDeviceInfo };
  } else {
    delete globalThis.PalmSystem;
  }
  if (webosDeviceInfo) {
    globalThis.webOSSystem = { deviceInfo: webosDeviceInfo };
  } else {
    delete globalThis.webOSSystem;
  }
  if (platformOverride !== null) {
    globalThis.__NUVIO_PLATFORM__ = platformOverride;
  } else {
    delete globalThis.__NUVIO_PLATFORM__;
  }

  try {
    importCounter += 1;
    const mod = await import(`./index.js?case=${importCounter}`);
    return mod.Platform.getWebOsMajorVersion();
  } finally {
    if (prevNavigatorDescriptor) {
      Object.defineProperty(globalThis, "navigator", prevNavigatorDescriptor);
    } else {
      delete globalThis.navigator;
    }
    if (prevPalmSystem !== undefined) {
      globalThis.PalmSystem = prevPalmSystem;
    } else {
      delete globalThis.PalmSystem;
    }
    if (prevWebOSSystem !== undefined) {
      globalThis.webOSSystem = prevWebOSSystem;
    } else {
      delete globalThis.webOSSystem;
    }
    if (prevOverride !== undefined) {
      globalThis.__NUVIO_PLATFORM__ = prevOverride;
    } else {
      delete globalThis.__NUVIO_PLATFORM__;
    }
  }
}

function loadPluginCapabilitySnapshot(PlatformMock, userAgent) {
  const source = readFileSync(new URL("../core/player/pluginPolicy.js", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?;\r?\n/gm, "")
    .replace(/^export /gm, "");
  return vm.runInNewContext(`${source}\n;({ getPluginCapabilitySnapshot })`, {
    Platform: PlatformMock,
    TizenCapabilities: { get: () => ({}) },
    Worker: function MockWorker() {},
    WebAssembly: {},
    navigator: { userAgent }
  }).getPluginCapabilitySnapshot;
}

test("Chromium UA fallback maps LG webOS generations accurately", async () => {
  const cases = [
    ["Mozilla/5.0 (Web0S; Linux/SmartTV) Chrome/38.0.2125.122 Safari/537.36", 3],
    ["Mozilla/5.0 (Web0S; Linux/SmartTV) Chrome/53.0.2785.143 Safari/537.36", 4],
    ["Mozilla/5.0 (Web0S; Linux/SmartTV) Chrome/68.0.3440.106 Safari/537.36", 5],
    ["Mozilla/5.0 (Web0S; Linux/SmartTV) Chromium/68.0.3440.106 Safari/537.36", 5],
    ["Mozilla/5.0 (Web0S; Linux/SmartTV) Chrome/79.0.3945.130 Safari/537.36", 6],
    ["Mozilla/5.0 (Web0S; Linux/SmartTV) Chrome/87.0.4280.88 Safari/537.36", 22],
    ["Mozilla/5.0 (Web0S; Linux/SmartTV) Chrome/94.0.4606.128 Safari/537.36", 23],
    ["Mozilla/5.0 (Web0S; Linux/SmartTV) Chrome/108.0.5359.215 Safari/537.36", 24],
    ["Mozilla/5.0 (Web0S; Linux/SmartTV) Chrome/120.0.6099.224 Safari/537.36", 25]
  ];

  for (const [userAgent, expected] of cases) {
    const version = await loadPlatformWithEnv({ userAgent });
    assert.equal(version, expected, `Expected ${userAgent} -> webOS ${expected}`);
  }
});

test("explicit webOS tokens take precedence over Chromium UA version", async () => {
  assert.equal(
    await loadPlatformWithEnv({
      palmDeviceInfo: "webOS.TV-22",
      userAgent: "Mozilla/5.0 Chrome/87.0.4280.88 Safari/537.36"
    }),
    22
  );
  assert.equal(
    await loadPlatformWithEnv({
      webosDeviceInfo: "web0s.tv/6",
      userAgent: "Mozilla/5.0 Chrome/79.0.3945.130 Safari/537.36"
    }),
    6
  );
  assert.equal(
    await loadPlatformWithEnv({
      userAgent: "Mozilla/5.0 (Web0S; Linux/SmartTV; webOS/5) Chrome/68.0.3440.106 Safari/537.36"
    }),
    5
  );
});

test("non-webOS runtimes return 0", async () => {
  assert.equal(
    await loadPlatformWithEnv({
      platformOverride: "browser",
      userAgent: "Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36"
    }),
    0
  );
  assert.equal(
    await loadPlatformWithEnv({
      platformOverride: "tizen",
      userAgent: "Mozilla/5.0 (SMART-TV; Linux; Tizen 9.0) Chrome/120.0.0.0 TV Safari/537.36"
    }),
    0
  );
});

test("webOS 5.0 Chromium 68 passes plugin runtime precheck while webOS 4.0 Chromium 53 is rejected", async () => {
  const webOs5Ua =
    "Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 Chrome/68.0.3440.106 Safari/537.36";
  const webOs5Version = await loadPlatformWithEnv({ userAgent: webOs5Ua });
  const webOs5Snapshot = loadPluginCapabilitySnapshot(
    {
      getName: () => "webos",
      getWebOsMajorVersion: () => webOs5Version
    },
    webOs5Ua
  )();
  assert.equal(webOs5Snapshot.webOsMajorVersion, 5);
  assert.equal(webOs5Snapshot.appSupported, true);
  assert.equal(webOs5Snapshot.normalAddonsSupported, true);
  assert.equal(webOs5Snapshot.precheckPassed, true);

  const webOs4Ua =
    "Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 Chrome/53.0.2785.143 Safari/537.36";
  const webOs4Version = await loadPlatformWithEnv({ userAgent: webOs4Ua });
  const webOs4Snapshot = loadPluginCapabilitySnapshot(
    {
      getName: () => "webos",
      getWebOsMajorVersion: () => webOs4Version
    },
    webOs4Ua
  )();
  assert.equal(webOs4Snapshot.webOsMajorVersion, 4);
  assert.equal(webOs4Snapshot.appSupported, false);
  assert.equal(webOs4Snapshot.precheckPassed, false);
});
