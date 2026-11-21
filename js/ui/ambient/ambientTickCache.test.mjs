import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("AmbientMode.tick avoids redundant AmbientModeStore.get calls while localStorage and profile stay unchanged", async () => {
  const source =
    (await readFile(new URL("./ambientMode.js", import.meta.url), "utf8"))
      .replace(/^import .*;$/gm, "")
      .replace(/export const /g, "const ") + "\nglobalThis.subject = AmbientMode;";

  let storeReads = 0;
  let rawSettingText = '{"enabled":true}';
  let profileId = "1";
  let settings = { enabled: true, timeoutMinutes: 5, catalogKeys: [] };

  const context = vm.createContext({
    Event,
    setTimeout: () => 1,
    clearTimeout() {},
    performance: { now: () => 1000 },
    console: { warn() {} },
    document: { hidden: false },
    localStorage: { getItem: (k) => (k === "ambientModeSettings" ? rawSettingText : null) },
    Platform: { isWebOS: () => false, isTizen: () => false },
    TizenScreenSaver: { block() {}, unblock() {} },
    isAmbientTrailerPlaying: () => false,
    Router: { getCurrent: () => "home", getCurrentScreen: () => null },
    ProfileManager: { getActiveProfileId: () => profileId },
    AmbientModeStore: {
      get: () => {
        storeReads += 1;
        return settings;
      }
    },
    loadAmbientSlides: () => new Promise(() => {})
  });
  context.globalThis = context;
  vm.runInContext(source, context);

  const ambient = context.subject;
  ambient.dismiss = () => {};
  ambient.show = () => {};

  for (let i = 0; i < 5; i += 1) {
    ambient.tick();
  }
  assert.equal(storeReads, 1, "repeated ticks with unchanged localStorage must read settings once");

  rawSettingText = '{"enabled":true,"timeoutMinutes":10}';
  settings = { enabled: true, timeoutMinutes: 10, catalogKeys: [] };
  ambient.tick();
  assert.equal(storeReads, 2, "external settings edit invalidates tick cache");

  profileId = "2";
  ambient.tick();
  assert.equal(storeReads, 3, "profile change invalidates tick cache");
});
