import assert from "node:assert/strict";
import { test } from "node:test";

import { SERVER_CONFIGURATION_KEY, ServerConfigurationStore } from "./serverConfigurationStore.js";
import { clearAccountLocalData } from "../../core/auth/accountLocalDataReset.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    key(index) {
      return Array.from(values.keys())[index] ?? null;
    },
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

const CUSTOM = {
  backendUrl: "https://backend.example.com",
  publishableKey: "public-client-key",
  capabilities: { emailPasswordAuth: true, tvLogin: false },
  isCustom: true,
  discoveryUrl: "https://backend.example.com/.well-known/nuvio"
};

test("persists and resolves a valid custom server", () => {
  const storage = memoryStorage();
  assert.equal(ServerConfigurationStore.saveCustom(CUSTOM, storage), true);
  const active = ServerConfigurationStore.getActive(storage);
  assert.equal(active.isCustom, true);
  assert.equal(active.backendUrl, CUSTOM.backendUrl);
  assert.equal(active.publishableKey, CUSTOM.publishableKey);
  assert.equal(active.capabilities.emailPasswordAuth, true);
});

test("falls back to official configuration for invalid stored data", () => {
  const storage = memoryStorage({ [SERVER_CONFIGURATION_KEY]: JSON.stringify({ broken: true }) });
  assert.equal(ServerConfigurationStore.getActive(storage).isCustom, false);
  storage.setItem(
    SERVER_CONFIGURATION_KEY,
    JSON.stringify({ ...CUSTOM, backendUrl: "https://192.168.1.20" })
  );
  assert.equal(ServerConfigurationStore.getActive(storage).isCustom, false);
});

test("restoring the official server removes only the server override", () => {
  const storage = memoryStorage();
  ServerConfigurationStore.saveCustom(CUSTOM, storage);
  storage.setItem("unrelated", "preserved");
  assert.equal(ServerConfigurationStore.useOfficial(storage), true);
  assert.equal(ServerConfigurationStore.getActive(storage).isCustom, false);
  assert.equal(storage.getItem("unrelated"), "preserved");
});

test("ordinary account cleanup preserves the selected server", () => {
  const storage = memoryStorage();
  ServerConfigurationStore.saveCustom(CUSTOM, storage);
  storage.setItem("profiles", JSON.stringify([{ id: "profile-1" }]));
  clearAccountLocalData(storage, memoryStorage());
  assert.equal(storage.getItem("profiles"), null);
  assert.equal(ServerConfigurationStore.getActive(storage).backendUrl, CUSTOM.backendUrl);
});
