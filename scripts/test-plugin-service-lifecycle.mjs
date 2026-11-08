// PluginService lifecycle on Tizen.
//
// The service is optional and only serves installed plugins, so the app shell
// must not launch it (or its watchdog) at boot. It starts on the first plugin
// use, and its watchdog must stay idle while the player route owns the TV.
import test from "node:test";
import assert from "node:assert/strict";

globalThis.__NUVIO_PLATFORM__ = "tizen";
globalThis.__NUVIO_TIZEN_VERSION__ = "6.5";

const { Platform } = await import("../js/platform/index.js");
// Platform.current stores the adapter object, not its name.
Platform.current = { name: "tizen" };
const { TizenPluginService } = await import("../js/platform/tizen/tizenPluginService.js");
const { PluginServiceClient } = await import("../js/platform/pluginServiceClient.js");

const HEALTH = {
  returnValue: true,
  status: "success",
  protocolVersion: 1,
  serviceVersion: 1,
  runtimeVersion: "1",
  quickjsVersion: "1",
  workerSupport: true,
  maxConcurrency: 1,
  memoryTier: "low",
  jsPluginCapability: true,
  networkBoundary: true
};

test("the service and its watchdog start on first use, not at boot", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let healthCalls = 0;
  TizenPluginService.health = async () => {
    healthCalls += 1;
    return { ...HEALTH };
  };
  TizenPluginService.probe = async () => ({ ...HEALTH });

  assert.equal(PluginServiceClient.isLifecycleMonitorRunning(), false);
  assert.deepEqual(await PluginServiceClient.checkLifecycleNow(), { status: "idle" });
  assert.equal(healthCalls, 0, "a foreground check must not start the service");

  assert.equal((await PluginServiceClient.ensureReady({ force: true })).returnValue, true);
  assert.equal(healthCalls, 1);
  assert.equal(PluginServiceClient.isLifecycleMonitorRunning(), true);

  PluginServiceClient.stopLifecycleMonitor();
});

test("the watchdog skips its probe while the player route is active", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let probeCalls = 0;
  TizenPluginService.health = async () => ({ ...HEALTH });
  TizenPluginService.probe = async () => {
    probeCalls += 1;
    return { ...HEALTH };
  };

  let playerActive = true;
  PluginServiceClient.configureLifecycleMonitor({ pauseProbeWhen: () => playerActive });
  await PluginServiceClient.ensureReady({ force: true });

  t.mock.timers.tick(10000);
  await Promise.resolve();
  assert.equal(probeCalls, 0, "no probe while the player route is active");

  playerActive = false;
  t.mock.timers.tick(10000);
  await Promise.resolve();
  assert.equal(probeCalls, 1);

  PluginServiceClient.stopLifecycleMonitor();
});
