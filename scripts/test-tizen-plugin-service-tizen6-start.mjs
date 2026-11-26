import assert from "node:assert/strict";

// Tizen 6 (QN95A, #1610/#1680) exposes only the wrt:service Service class.
// Starting the service through it ties the service to the app: after playback
// the source search could not reach PluginService (2711) again until the app
// was restarted. Tizen 6-8 must launch the service as its own application, as
// 1.4.1 did, so PluginService stays restartable while Nuvio runs.
globalThis.__NUVIO_PLATFORM__ = "tizen";
globalThis.__NUVIO_TIZEN_PLUGIN_SERVICE_ID__ = "DemoPkg.PluginService";

let serviceStarted = false;
let serviceClassStartCalls = 0;
let applicationLaunchCalls = 0;
let applicationControlCalls = 0;

globalThis.tizen = {
  ApplicationControl: class ApplicationControl {
    constructor(operation) {
      this.operation = operation;
    }
  },
  systeminfo: {
    getCapability(name) {
      if (name.includes("platform.version")) return "6.0";
      if (name.includes("web.service")) return false;
      return false;
    }
  },
  application: {
    getCurrentApplication() {
      return { appInfo: { packageId: "DemoPkg" } };
    },
    launchAppControl(_control, serviceId, onSuccess) {
      assert.equal(serviceId, "DemoPkg.PluginService");
      applicationControlCalls += 1;
      serviceStarted = true;
      onSuccess?.();
    },
    launch(serviceId, onSuccess) {
      assert.equal(serviceId, "DemoPkg.PluginService");
      applicationLaunchCalls += 1;
      serviceStarted = true;
      onSuccess?.();
    }
  }
};

globalThis.__NUVIO_TIZEN_WRT_SERVICE__ = {
  Service: class Service {
    constructor(serviceId) {
      assert.equal(serviceId, "DemoPkg.PluginService");
    }
    start() {
      serviceClassStartCalls += 1;
      serviceStarted = true;
      return new Promise(() => {});
    }
  }
};

globalThis.fetch = async (url) => {
  if (!serviceStarted) throw new TypeError("Failed to fetch");
  // The /fetch endpoint keeps the same envelope; the test only needs the
  // service to answer again after the relaunch.
  return {
    ok: true,
    json: async () => ({
      returnValue: true,
      service: "nuvio-plugin-network",
      protocolVersion: 1,
      url
    })
  };
};

const { TizenPluginService } = await import("../js/platform/tizen/tizenPluginService.js");

const started = await TizenPluginService.ensureStarted();
assert.equal(started.status, "success");
assert.equal(started.startMethod, "tizen-application-launch");
assert.equal(applicationLaunchCalls, 1);
assert.equal(serviceClassStartCalls, 0, "Tizen 6 must not start the service through the class");
assert.equal(applicationControlCalls, 0);

// A playback can still stop the service process. The next request must detect
// the dead endpoint and relaunch it as its own application, without an app
// restart.
serviceStarted = false;
await assert.rejects(
  TizenPluginService.fetch(
    { url: "https://example.com/stream", requestId: "poll-1" },
    { timeoutMs: 500 }
  )
);
const recovered = await TizenPluginService.ensureStarted();
assert.equal(recovered.status, "success");
assert.equal(applicationLaunchCalls, 2);
assert.equal(serviceClassStartCalls, 0);

console.log("tizen 6 plugin service start test passed");
