const SCREEN_SAVER_OFF = 0;
const SCREEN_SAVER_ON = 1;

let blocked = false;

function applyScreenSaver(state) {
  try {
    const appcommon = globalThis.webapis?.appcommon;
    if (typeof appcommon?.setScreenSaver !== "function") return;
    const states = appcommon.AppCommonScreenSaverState;
    const value =
      state === SCREEN_SAVER_OFF
        ? (states?.SCREEN_SAVER_OFF ?? SCREEN_SAVER_OFF)
        : (states?.SCREEN_SAVER_ON ?? SCREEN_SAVER_ON);
    appcommon.setScreenSaver(value);
  } catch (_) {
    // The Samsung screensaver API is optional and can reject on older runtimes.
  }
}

// Samsung's screensaver covers app content with a black screen. Ambient Mode
// must keep it disabled while it owns the idle screen.
export const TizenScreenSaver = {
  block() {
    if (blocked) return;
    blocked = true;
    applyScreenSaver(SCREEN_SAVER_OFF);
  },

  unblock() {
    if (!blocked) return;
    blocked = false;
    applyScreenSaver(SCREEN_SAVER_ON);
  }
};
