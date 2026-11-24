import test from "node:test";
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};
const { LocalStore } = await import("../js/core/storage/localStore.js");
const { mediaServerDeviceId, mediaServerHeaders } =
  await import("../js/data/mediaserver/mediaBrowserClient.js");

// Android ServerRepositoryTest.deviceIdIsSeparateForEachSecondaryProfile
test("each secondary profile sends its own media server DeviceId", () => {
  LocalStore.set("mediaServerDeviceId", "device-1");
  assert.equal(mediaServerDeviceId(), "device-1");
  LocalStore.set("activeProfileId", "2");
  assert.equal(mediaServerDeviceId(), "device-1-p2");
  assert.match(
    mediaServerHeaders({ providerId: "jellyfin" }).Authorization,
    /DeviceId="device-1-p2"/
  );
  LocalStore.set("activeProfileId", "3");
  assert.equal(mediaServerDeviceId(), "device-1-p3");
  LocalStore.set("activeProfileId", "1");
  assert.equal(mediaServerDeviceId(), "device-1");
  assert.equal(mediaServerDeviceId("4"), "device-1-p4");
});
