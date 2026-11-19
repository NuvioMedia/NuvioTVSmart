import assert from "node:assert/strict";

import {
  getTizenEngineFsStartMethods,
  getTizenServiceStartMethods
} from "../js/platform/tizen/tizenWrtService.js";

// Tizen 5.5 acknowledges wrt:service without starting the service, so the
// service must be launched directly there; Tizen 9/10 expose only the Service
// class. application-control can disturb the foreground app when web.service
// is unavailable, so it stays behind an explicit true capability.
assert.deepEqual(
  getTizenServiceStartMethods({
    webServiceSupported: false,
    tizenMajorVersion: 5,
    tizenMinorVersion: 5
  }),
  ["tizen-application-launch", "wrt-service"]
);

assert.deepEqual(
  getTizenServiceStartMethods({
    webServiceSupported: true,
    tizenMajorVersion: 5,
    tizenMinorVersion: 5,
    hasServiceClass: true
  }),
  ["tizen-application-launch", "wrt-service"]
);

assert.deepEqual(
  getTizenServiceStartMethods({
    webServiceSupported: false,
    tizenMajorVersion: 5,
    tizenMinorVersion: 0
  }),
  ["wrt-service", "tizen-application-launch"]
);

assert.deepEqual(
  getTizenServiceStartMethods({
    webServiceSupported: true,
    tizenMajorVersion: 6
  }),
  ["wrt-service", "tizen-application-control-default", "tizen-application-launch"]
);

assert.deepEqual(
  getTizenServiceStartMethods({
    webServiceSupported: true,
    tizenMajorVersion: 10,
    hasServiceClass: true
  }),
  ["wrt-service", "tizen-application-launch"]
);

// EngineFS on Tizen 6-8 keeps the 1.4.1 order (#1408); 5.x and Service-class
// runtimes follow the shared order.
assert.deepEqual(
  getTizenEngineFsStartMethods({ webServiceSupported: true, tizenMajorVersion: 6 }),
  ["tizen-application-control-default", "tizen-application-launch", "wrt-service"]
);
assert.deepEqual(
  getTizenEngineFsStartMethods({ webServiceSupported: null, tizenMajorVersion: 7 }),
  ["tizen-application-control-default", "tizen-application-launch", "wrt-service"]
);
assert.deepEqual(
  getTizenEngineFsStartMethods({ webServiceSupported: false, tizenMajorVersion: 6 }),
  ["wrt-service", "tizen-application-launch"]
);
assert.deepEqual(
  getTizenEngineFsStartMethods({
    webServiceSupported: true,
    tizenMajorVersion: 10,
    hasServiceClass: true
  }),
  ["wrt-service", "tizen-application-launch"]
);
assert.deepEqual(
  getTizenEngineFsStartMethods({
    webServiceSupported: false,
    tizenMajorVersion: 5,
    tizenMinorVersion: 5
  }),
  ["tizen-application-launch", "wrt-service"]
);

console.log("tizen service start order test passed");
