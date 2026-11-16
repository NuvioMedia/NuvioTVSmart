import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// On Tizen the app disables the Samsung screensaver while Ambient is eligible.
// It must not re-enable it while the app is terminating: on sets where the TV
// screensaver is a black fade, re-enabling it at exit covers the app teardown
// and Smart Hub for seconds (#1375). A normal hide still restores it.

const source =
  (await readFile(new URL("../js/ui/ambient/ambientMode.js", import.meta.url), "utf8"))
    .replace(/^import .*;$/gm, "")
    .replace(/export const /g, "const ") + "\nglobalThis.subject = AmbientMode;";

const settings = { enabled: true, timeoutMinutes: 5, catalogKeys: [] };

function createAmbient() {
  let clock = 0;
  const listeners = { document: new Map(), window: new Map() };
  const calls = { blocks: 0, unblocks: 0 };
  const add = (target) => (type, listener) => {
    const map = listeners[target];
    if (!map.has(type)) map.set(type, []);
    map.get(type).push(listener);
  };
  const document = {
    hidden: false,
    addEventListener: add("document"),
    dispatch(type) {
      (listeners.document.get(type) || []).forEach((listener) => listener());
    }
  };
  const context = vm.createContext({
    Event,
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
    performance: { now: () => clock },
    console: { warn() {} },
    document,
    window: { addEventListener: add("window") },
    Platform: { isWebOS: () => false, isTizen: () => true },
    TizenScreenSaver: {
      block() {
        calls.blocks += 1;
      },
      unblock() {
        calls.unblocks += 1;
      }
    },
    isAmbientTrailerPlaying: () => false,
    Router: { getCurrent: () => "home", getCurrentScreen: () => null },
    ProfileManager: { getActiveProfileId: () => "1" },
    AmbientModeStore: { get: () => settings },
    loadAmbientSlides: () => new Promise(() => {})
  });
  vm.runInContext(source, context);
  const ambient = context.subject;
  ambient.dismiss = () => {
    ambient.showing = false;
  };
  ambient.start();
  return {
    ambient,
    document,
    calls,
    advance(ms) {
      clock += ms;
    },
    exit() {
      document.dispatch("nuvio:beforeExitApp");
    },
    hide() {
      document.hidden = true;
      document.dispatch("visibilitychange");
    },
    tick() {
      ambient.tick();
    }
  };
}

// Exit after the screensaver block is armed: no native call while terminating.
{
  const app = createAmbient();
  app.advance(10000);
  app.tick();
  assert.equal(app.calls.blocks, 1, "screensaver disabled while Ambient is eligible");

  app.exit();
  app.hide();
  app.tick();
  assert.equal(app.calls.unblocks, 0, "exit never re-enables the Samsung screensaver");
  assert.equal(app.ambient.exiting, true);
}

// A normal hide still restores the TV screensaver for the foreground launcher.
{
  const app = createAmbient();
  app.advance(10000);
  app.tick();
  assert.equal(app.calls.blocks, 1);

  app.hide();
  assert.equal(app.calls.unblocks, 1, "backgrounded app restores the TV screensaver");
}

console.log("Tizen ambient exit screensaver checks passed");
