import assert from "node:assert/strict";
import test from "node:test";
import {
  createHomeRowWindow,
  isHomeRowWindowSupported,
  HOME_ROW_PARKED_CLASS
} from "./homeRowWindow.js";

function section({ height = 392, focused = false, rowKey = "" } = {}) {
  const classes = new Set();
  const node = {
    isConnected: true,
    offsetHeight: height,
    style: { height: "" },
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name)
    },
    dataset: { rowKey },
    querySelector: (selector) => (selector === ".focused" && focused ? {} : null),
    previousElementSibling: null,
    nextElementSibling: null
  };
  node.closest = () => node;
  return node;
}

function setup(sections) {
  const observers = [];
  class IntersectionObserver {
    constructor(callback) {
      this.callback = callback;
      this.targets = new Set();
      this.connected = true;
      observers.push(this);
    }
    observe(target) {
      this.targets.add(target);
    }
    unobserve(target) {
      this.targets.delete(target);
    }
    disconnect() {
      this.connected = false;
    }
  }
  const rowWindow = createHomeRowWindow({ root: {}, scope: { IntersectionObserver } });
  rowWindow.observe(sections);
  const report = (visible) =>
    observers[observers.length - 1].callback(
      sections.map((target, index) => ({ target, isIntersecting: visible.includes(index) }))
    );
  return { rowWindow, observers, report };
}

const parked = (node) => node.classList.contains(HOME_ROW_PARKED_CLASS);

test("rows outside the margin keep their height and are parked", () => {
  const rows = [section(), section(), section({ height: 285 })];
  const { report } = setup(rows);
  report([0]);
  assert.equal(parked(rows[0]), false);
  assert.equal(parked(rows[2]), true);
  assert.equal(rows[2].style.height, "285px");
});

test("a row coming back inside the margin is restored", () => {
  const rows = [section(), section()];
  const { report } = setup(rows);
  report([0]);
  report([0, 1]);
  assert.equal(parked(rows[1]), false);
  assert.equal(rows[1].style.height, "");
});

test("the focused row and empty rows are never parked", () => {
  const rows = [section({ focused: true }), section({ height: 0 })];
  const { report } = setup(rows);
  report([]);
  assert.equal(parked(rows[0]), false);
  assert.equal(parked(rows[1]), false);
});

test("ensureReady restores the target row and its neighbours in the same task", () => {
  const rows = [section(), section(), section(), section()];
  rows[2].previousElementSibling = rows[1];
  rows[2].nextElementSibling = rows[3];
  const { rowWindow, observers, report } = setup(rows);
  report([]);
  assert.equal(rowWindow.ensureReady(rows[2]), true);
  assert.deepEqual(rows.map(parked), [true, false, false, false]);
  // The hand-restored rows are re-reported by a fresh observer.
  assert.equal(observers.length, 2);
  assert.equal(observers[0].connected, false);
  assert.equal(observers[1].targets.size, 4);
  assert.equal(rowWindow.ensureReady(rows[2]), false);
});

test("restoring a saved position wakes only the rows it names", () => {
  const rows = [section({ rowKey: "a" }), section({ rowKey: "b" }), section({ rowKey: "c" })];
  const { rowWindow, report } = setup(rows);
  report([]);
  assert.equal(rowWindow.ensureRowKeysReady(["b", undefined, ""]), true);
  assert.deepEqual(rows.map(parked), [true, false, true]);
  assert.equal(rowWindow.ensureRowKeysReady(["missing"]), false);
});

test("observe drops removed rows; destroy leaves rows parked for the next window", () => {
  const rows = [section(), section()];
  const { rowWindow, observers, report } = setup(rows);
  report([]);
  rowWindow.observe([rows[0]]);
  assert.equal(observers[0].targets.has(rows[1]), false);
  rowWindow.destroy();
  assert.equal(observers[0].connected, false);
  assert.equal(parked(rows[0]), true);
  // A new window over the same DOM restores the rows that come into view.
  const next = setup(rows);
  next.report([0]);
  assert.equal(parked(rows[0]), false);
});

test("the kill switch and missing IntersectionObserver disable the window", () => {
  assert.equal(isHomeRowWindowSupported({}), false);
  assert.equal(
    isHomeRowWindowSupported({ IntersectionObserver() {}, __NUVIO_HOME_ROW_WINDOW__: false }),
    false
  );
  assert.equal(isHomeRowWindowSupported({ IntersectionObserver() {} }), true);
});
