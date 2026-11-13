import assert from "node:assert/strict";

// Tizen 9/10 (#1325): wrt:service exports the Service class instead of
// startService(), application.launch is acknowledged without starting the
// service, and Service#start() may stay pending while the service runs.
globalThis.__NUVIO_PLATFORM__ = "tizen";
globalThis.__NUVIO_TIZEN_PLUGIN_SERVICE_ID__ = "DemoPkg.PluginService";

let serviceStarted = false;
let serviceStartCalls = 0;
let applicationLaunchCalls = 0;

globalThis.tizen = {
  systeminfo: {
    getCapability(name) {
      if (name.includes("platform.version")) return "10.0";
      if (name.includes("web.service")) return false;
      return false;
    }
  },
  application: {
    launch(_serviceId, onSuccess) {
      applicationLaunchCalls += 1;
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
      serviceStartCalls += 1;
      serviceStarted = true;
      return new Promise(() => {});
    }
  }
};

globalThis.fetch = async () => {
  if (!serviceStarted) throw new TypeError("Failed to fetch");
  return {
    ok: true,
    json: async () => ({
      returnValue: true,
      service: "nuvio-plugin-network",
      protocolVersion: 1
    })
  };
};

const { TizenPluginService } = await import("../js/platform/tizen/tizenPluginService.js");

const result = await TizenPluginService.ensureStarted();
assert.equal(result.status, "success");
assert.equal(serviceStartCalls, 1);
assert.equal(applicationLaunchCalls, 0);

console.log("tizen plugin service wrt Service class test passed");
