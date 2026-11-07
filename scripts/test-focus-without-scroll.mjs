import test from "node:test";
import assert from "node:assert/strict";

import {
  focusWithoutScroll,
  resetFocusWithoutScrollSupportForTests
} from "../js/ui/navigation/focusWithoutScroll.js";

// Minimal stand-ins for a focus target and its ancestor chain. Scroll offsets are backed by
// accessors so each test can see every write the helper makes.
function fakeNode({ parent = null, scrollable = true, top = 0, left = 0 } = {}) {
  const writes = [];
  const node = {
    parentElement: parent,
    scrollWidth: scrollable ? 1000 : 100,
    clientWidth: 100,
    scrollHeight: scrollable ? 1000 : 100,
    clientHeight: 100
  };
  Object.defineProperty(node, "scrollTop", {
    get: () => top,
    set(value) {
      writes.push(["top", value]);
      top = value;
    }
  });
  Object.defineProperty(node, "scrollLeft", {
    get: () => left,
    set(value) {
      writes.push(["left", value]);
      left = value;
    }
  });
  // Lets a fake focus() move the ancestor the way a native reveal would, without logging it.
  node.nativeScroll = (nextTop, nextLeft) => {
    top = nextTop;
    left = nextLeft;
  };
  node.writes = writes;
  return node;
}

function fakeWindow(x = 0, y = 0) {
  const calls = [];
  return {
    get scrollX() {
      return x;
    },
    get scrollY() {
      return y;
    },
    scrollTo(nextX, nextY) {
      calls.push([nextX, nextY]);
      x = nextX;
      y = nextY;
    },
    nativeScroll(nextX, nextY) {
      x = nextX;
      y = nextY;
    },
    calls
  };
}

function withGlobals(globalsToSet, run) {
  const previous = new Map();
  for (const [name, value] of Object.entries(globalsToSet)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    globalThis[name] = value;
  }
  try {
    return run();
  } finally {
    for (const [name, descriptor] of previous) {
      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
      } else {
        delete globalThis[name];
      }
    }
  }
}

test("supporting engine: focus gets preventScroll and scroll offsets are never written", () => {
  resetFocusWithoutScrollSupportForTests();
  const win = fakeWindow(10, 20);
  withGlobals({ window: win }, () => {
    const outer = fakeNode({ top: 300, left: 40 });
    const inner = fakeNode({ parent: outer, top: 120 });
    const received = [];
    const element = {
      parentElement: inner,
      focus(options) {
        received.push(options);
        // Reading the option is what a FocusOptions-aware engine does; it honours it, so no scroll.
        assert.equal(options.preventScroll, true);
        return "focused";
      }
    };

    // First call detects support through the getter and still passes preventScroll: true.
    assert.equal(focusWithoutScroll(element), "focused");
    assert.equal(received.length, 1);
    assert.equal(received[0].preventScroll, true);

    // Later calls use the plain option object and forward extra options.
    focusWithoutScroll(element, { focusVisible: false });
    assert.equal(received.length, 2);
    assert.deepEqual(Object.getOwnPropertyDescriptor(received[1], "preventScroll"), {
      value: true,
      writable: true,
      enumerable: true,
      configurable: true
    });
    assert.equal(received[1].focusVisible, false);

    assert.deepEqual(inner.writes, []);
    assert.deepEqual(outer.writes, []);
    assert.deepEqual(win.calls, []);
  });
});

test("supporting engine detected on a detached probe never touches the real element's ancestors", () => {
  resetFocusWithoutScrollSupportForTests();
  let probes = 0;
  const document = {
    createElement() {
      probes += 1;
      return {
        focus(options) {
          void options.preventScroll;
        }
      };
    }
  };
  withGlobals({ document }, () => {
    let reads = 0;
    const outer = {
      parentElement: null,
      scrollWidth: 1000,
      clientWidth: 100,
      scrollHeight: 1000,
      clientHeight: 100,
      scrollLeft: 0,
      get scrollTop() {
        reads += 1;
        return 300;
      },
      set scrollTop(_value) {}
    };
    const received = [];
    const element = { parentElement: outer, focus: (options) => received.push(options) };
    focusWithoutScroll(element);
    focusWithoutScroll(element);
    assert.equal(probes, 1, "detection runs once");
    assert.equal(received.length, 2);
    for (const options of received) {
      assert.equal(options.preventScroll, true);
      assert.equal(Object.getOwnPropertyDescriptor(options, "preventScroll").value, true);
    }
    assert.equal(reads, 0, "no scroll snapshot is taken once support is known");
  });
});

test("non-supporting engine: ancestor and viewport offsets moved by focus() are restored", () => {
  resetFocusWithoutScrollSupportForTests();
  const win = fakeWindow(0, 500);
  withGlobals({ window: win }, () => {
    const root = fakeNode({ top: 900, left: 0 });
    const still = fakeNode({ parent: root, scrollable: false, top: 0 });
    const rail = fakeNode({ parent: still, top: 0, left: 640 });
    const calls = [];
    const element = {
      parentElement: rail,
      focus(...args) {
        calls.push(args);
        // Mimic Chromium < 64: the option is ignored and every scroller reveals the element.
        rail.nativeScroll(0, 0);
        root.nativeScroll(0, 0);
        win.nativeScroll(0, 0);
      }
    };

    focusWithoutScroll(element);
    assert.equal(calls.length, 1);
    assert.equal(rail.scrollLeft, 640);
    assert.equal(rail.scrollTop, 0);
    assert.equal(root.scrollTop, 900);
    assert.equal(win.scrollX, 0);
    assert.equal(win.scrollY, 500);
    assert.deepEqual(rail.writes, [["left", 640]]);
    assert.deepEqual(root.writes, [["top", 900]]);
    assert.deepEqual(still.writes, [], "non-scrollable ancestors are ignored");
    assert.deepEqual(win.calls, [[0, 500]]);

    // Support is remembered as missing: the next call is a plain focus() with no options.
    focusWithoutScroll(element, { focusVisible: true });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].length, 0);
    assert.equal(rail.scrollLeft, 640);
    assert.equal(root.scrollTop, 900);
    assert.equal(win.scrollY, 500);
  });
});

test("non-supporting engine: offsets that did not move are left alone", () => {
  resetFocusWithoutScrollSupportForTests();
  const parent = fakeNode({ top: 50, left: 60 });
  const element = { parentElement: parent, focus() {} };
  focusWithoutScroll(element);
  assert.deepEqual(parent.writes, []);
});

test("a throwing focus() never propagates", () => {
  resetFocusWithoutScrollSupportForTests();
  const parent = fakeNode({ top: 50 });
  let attempts = 0;
  const element = {
    parentElement: parent,
    focus() {
      attempts += 1;
      throw new Error("focus rejected during DOM churn");
    }
  };
  assert.doesNotThrow(() => focusWithoutScroll(element));
  assert.ok(attempts >= 1);

  // An engine that rejects the options object but accepts a bare focus() still gets focused.
  resetFocusWithoutScrollSupportForTests();
  let plainFocused = false;
  const picky = {
    parentElement: null,
    focus(options) {
      if (options !== undefined) {
        throw new TypeError("no options here");
      }
      plainFocused = true;
    }
  };
  assert.doesNotThrow(() => focusWithoutScroll(picky));
  assert.equal(plainFocused, true);

  // Missing or non-focusable targets are a no-op rather than an error.
  assert.equal(focusWithoutScroll(null), undefined);
  assert.equal(focusWithoutScroll(undefined), undefined);
  assert.equal(focusWithoutScroll({}), undefined);
});
