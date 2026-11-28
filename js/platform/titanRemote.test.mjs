import assert from "node:assert/strict";
import { test } from "node:test";
import { installTitanRemote, isTitanOsUserAgent } from "./titanRemote.js";

const TITAN_UA =
  "Mozilla/5.0 (Linux armv7l) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/112.0.4147.62 Safari/537.36 OPR/46.0.2207.0 OMI/4.24, " +
  "TV_NT72690_2025_4K/056.002.236.191 (Philips, PUS8000, wireless) " +
  "CE-HTML/1.0 NETTV/4.6.0.8 SignOn/2.0 SmartTvA/5.0.0 WhaleTV/2.0 TitanOS/3.0 en Ginga";
const SAPHI_UA =
  "Mozilla/5.0 (Linux armv7l) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/49.0.2623.112 Safari/537.36 OPR/36.0.2128.0 OMI/4.8.0.129, " +
  "HbbTV/1.1.1 _TV_MT5806/201.000.115.000 (Philips, PUS7805, wireless) " +
  "CE-HTML/1.0 NETTV/4.6.0.2 SmartTvA/5.0.0 WH1.0";

class FakeKeyboardEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.key = init.key;
    this.code = init.code;
    this.repeat = Boolean(init.repeat);
    this.defaultPrevented = false;
  }

  preventDefault() {
    this.defaultPrevented = true;
  }

  stopImmediatePropagation() {
    this.immediateStopped = true;
  }

  // Chromium 112 ignores keyCode in the init dictionary.
  get keyCode() {
    return 0;
  }
}

function createWindow(element = null) {
  const listeners = new Map();
  const dispatched = [];
  const body = {
    tagName: "BODY",
    dispatchEvent(event) {
      dispatched.push(event);
      return true;
    }
  };
  const document = {
    activeElement: element || body,
    body,
    documentElement: body
  };
  const window = {
    document,
    KeyboardEvent: FakeKeyboardEvent,
    addEventListener(type, listener) {
      const list = listeners.get(type) || [];
      list.push(listener);
      listeners.set(type, list);
    }
  };
  const press = (type, props) => {
    const event = {
      type,
      target: body,
      ...props,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopImmediatePropagation() {
        this.immediateStopped = true;
      }
    };
    for (const listener of listeners.get(type) || []) {
      listener(event);
    }
    return event;
  };
  return { window, dispatched, press };
}

test("detects only Titan OS browsers, not Saphi or desktop", () => {
  assert.equal(isTitanOsUserAgent(TITAN_UA), true);
  assert.equal(isTitanOsUserAgent(SAPHI_UA), false);
  assert.equal(isTitanOsUserAgent("Mozilla/5.0 (Macintosh) Chrome/140 Safari/537.36"), false);
  assert.equal(isTitanOsUserAgent(""), false);
});

test("number pad drives the focus engine as D-pad keys", () => {
  const { window, dispatched, press } = createWindow();
  assert.equal(installTitanRemote(window), true);

  const keydown = press("keydown", { key: "2", keyCode: 50 });
  assert.equal(keydown.defaultPrevented, true);
  assert.equal(keydown.immediateStopped, true);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].key, "ArrowUp");
  assert.equal(dispatched[0].keyCode, 38);

  press("keyup", { key: "2", keyCode: 50 });
  assert.equal(dispatched.length, 2);
  assert.equal(dispatched[1].type, "keyup");
  assert.equal(dispatched[1].key, "ArrowUp");
});

test("maps every documented key", () => {
  const { window, dispatched, press } = createWindow();
  installTitanRemote(window);

  const expected = [
    ["8", 56, "ArrowDown", 40],
    ["4", 52, "ArrowLeft", 37],
    ["6", 54, "ArrowRight", 39],
    ["5", 53, "Enter", 13],
    ["0", 48, "Escape", 27]
  ];
  for (const [key, keyCode, expectedKey, expectedCode] of expected) {
    const event = press("keydown", { key, keyCode });
    const synthetic = dispatched.at(-1);
    assert.equal(event.defaultPrevented, true);
    assert.equal(synthetic.key, expectedKey);
    assert.equal(synthetic.keyCode, expectedCode);
  }
});

test("keeps the physical Back key inside the app", () => {
  const { window, dispatched, press } = createWindow();
  installTitanRemote(window);

  const keydown = press("keydown", { key: "Backspace", keyCode: 8 });
  assert.equal(keydown.defaultPrevented, true);
  assert.equal(keydown.immediateStopped, undefined);
  assert.equal(dispatched.length, 0);
});

test("leaves text fields and unrelated keys alone", () => {
  const input = { tagName: "INPUT" };
  {
    const { window, dispatched, press } = createWindow(input);
    installTitanRemote(window);
    const event = press("keydown", { key: "5", keyCode: 53, target: input });
    assert.equal(event.defaultPrevented, undefined);
    assert.equal(dispatched.length, 0);
  }
  {
    const { window, dispatched, press } = createWindow();
    installTitanRemote(window);
    const event = press("keydown", { key: "a", keyCode: 65 });
    assert.equal(event.defaultPrevented, undefined);
    assert.equal(dispatched.length, 0);
  }
});

test("does not translate its own synthetic events", () => {
  const { window, dispatched, press } = createWindow();
  installTitanRemote(window);

  press("keydown", { key: "5", keyCode: 53, __nuvioTitanKey: true });
  assert.equal(dispatched.length, 0);
});
