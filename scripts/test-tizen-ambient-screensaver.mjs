import assert from "node:assert/strict";

const calls = [];
globalThis.webapis = {
  appcommon: {
    AppCommonScreenSaverState: { SCREEN_SAVER_OFF: 0, SCREEN_SAVER_ON: 1 },
    setScreenSaver(state) {
      calls.push(state);
    }
  }
};

const { TizenScreenSaver } = await import("../js/platform/tizen/tizenScreenSaver.js");

TizenScreenSaver.block();
TizenScreenSaver.block();
assert.deepEqual(calls, [0], "block disables the Samsung screensaver once");
TizenScreenSaver.unblock();
TizenScreenSaver.unblock();
assert.deepEqual(calls, [0, 1], "unblock re-enables the Samsung screensaver once");

delete globalThis.webapis;
TizenScreenSaver.block();
TizenScreenSaver.unblock();

globalThis.webapis = {
  appcommon: {
    setScreenSaver() {
      throw new Error("unsupported");
    }
  }
};
TizenScreenSaver.block();
TizenScreenSaver.unblock();

globalThis.webapis = {
  appcommon: {
    setScreenSaver(state) {
      calls.push(state);
    }
  }
};
TizenScreenSaver.block();
TizenScreenSaver.unblock();
assert.deepEqual(calls, [0, 1, 0, 1], "numeric states are used when constants are unavailable");

console.log("Tizen ambient screensaver checks passed");
