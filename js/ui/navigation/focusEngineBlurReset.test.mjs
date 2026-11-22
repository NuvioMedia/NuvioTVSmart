import assert from "node:assert/strict";
import test from "node:test";

// A TV can background the app with a key still held: keyup never arrives, so
// FocusEngine must drop its key tracking on blur/visibility loss like Android
// does when the window loses focus. Otherwise the Back latch stays closed.

const docListeners = new Map();
const windowListeners = new Map();

function record(map) {
  return (type, listener) => {
    if (!map.has(type)) map.set(type, []);
    map.get(type).push(listener);
  };
}

const documentMock = {
  hidden: false,
  webkitHidden: false,
  visibilityState: "visible",
  activeElement: null,
  body: { classList: { contains: () => false } },
  documentElement: { classList: { add() {} } },
  addEventListener: record(docListeners),
  contains: () => true
};

globalThis.document = documentMock;
globalThis.window = { addEventListener: record(windowListeners) };
globalThis.__NUVIO_PLATFORM__ = "browser";
Object.defineProperty(globalThis, "navigator", {
  value: { userAgent: "Mozilla/5.0" },
  configurable: true
});

const { FocusEngine } = await import("./focusEngine.js");
const { Router } = await import("./routerState.js");

let backs = 0;
let lastKeyUp = null;
Router.getCurrentScreen = () => ({ onKeyUp: (event) => (lastKeyUp = event) });
Router.back = () => {
  backs += 1;
};
Router.consumeRouteReturnBackGuard = () => false;
Router.suppressNextPopstate = () => {};

FocusEngine.init();

function dispatch(type, event) {
  for (const listener of docListeners.get(type) || []) listener(event);
}

function dispatchWindow(type) {
  for (const listener of windowListeners.get(type) || []) listener({ type });
}

function keyEvent({ key = "ArrowRight", keyCode = 39, repeat = false } = {}) {
  return {
    key,
    keyCode,
    repeat,
    timeStamp: 1000,
    target: {},
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {}
  };
}

function pressBack() {
  FocusEngine.lastBackHandledAt = 0;
  dispatch("keydown", keyEvent({ key: "XF86Back", keyCode: 10009 }));
}

test("Back works again after the window blurs without a keyup", () => {
  backs = 0;
  pressBack();
  assert.equal(backs, 1);
  assert.equal(FocusEngine.activeBackKeyIdentities.has("back"), true);

  // The held Back is released while another app owns the screen: no keyup.
  dispatchWindow("blur");
  assert.equal(FocusEngine.activeBackKeyIdentities.size, 0);

  pressBack();
  assert.equal(backs, 2, "the first Back after focus loss must navigate");
});

test("hidden visibilitychange clears the Back latch, visible does not", () => {
  FocusEngine.resetActiveKeys();
  backs = 0;
  pressBack();
  assert.equal(backs, 1);

  documentMock.hidden = false;
  dispatch("visibilitychange");
  assert.equal(
    FocusEngine.activeBackKeyIdentities.has("back"),
    true,
    "a visible transition keeps live key state"
  );

  documentMock.hidden = true;
  dispatch("visibilitychange");
  assert.equal(FocusEngine.activeBackKeyIdentities.size, 0);

  pressBack();
  assert.equal(backs, 2);
  documentMock.hidden = false;
});

test("legacy webOS webkitvisibilitychange also resets a held key", () => {
  FocusEngine.resetActiveKeys();
  lastKeyUp = null;
  dispatch("keydown", keyEvent());
  assert.equal(FocusEngine.activeKeyDownStartedAt.size, 1);

  documentMock.webkitHidden = true;
  dispatch("webkitvisibilitychange");
  assert.equal(FocusEngine.activeKeyDownStartedAt.size, 0);
  documentMock.webkitHidden = false;

  // A keyup delivered after resume must not turn into a huge long press.
  dispatch("keyup", keyEvent());
  assert.equal(lastKeyUp?.keyDownDurationMs, 0);
});
