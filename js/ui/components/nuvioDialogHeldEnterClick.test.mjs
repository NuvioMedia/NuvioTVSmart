import assert from "node:assert/strict";
import test from "node:test";

// Held OK that opened a hold menu: keyboard-synthesized clicks (detail 0) on the focused button
// must not run its action until the key is released; real pointer clicks (detail >= 1) still do.

function makeEl() {
  const listeners = {};
  return {
    className: "",
    dataset: {},
    children: [],
    firstChild: null,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    style: {},
    setAttribute() {},
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
    focus() {},
    fire(type, event) {
      listeners[type]?.(event);
    }
  };
}

const created = [];
globalThis.document = {
  createElement: () => {
    const el = makeEl();
    created.push(el);
    return el;
  },
  addEventListener() {},
  removeEventListener() {},
  body: { classList: { add() {}, remove() {} } }
};
const windowListeners = {};
globalThis.window = {
  addEventListener: (type, fn) => (windowListeners[type] = fn),
  removeEventListener() {}
};
globalThis.requestAnimationFrame = () => {};

const { NuvioDialog } = await import("./nuvioDialog.js");

function open(suppress) {
  created.length = 0;
  const actions = [];
  const dialog = new NuvioDialog({
    title: "t",
    suppressEnterUntilKeyUp: suppress,
    buttons: [{ label: "Go", key: "go", onAction: () => actions.push("go") }]
  }).mount({ appendChild() {} });
  const button = created.find((el) => el.dataset.key === "go");
  return { dialog, button, actions };
}

test("keyboard click while the opening Enter is still held does nothing", () => {
  const { button, actions } = open(true);
  for (let i = 0; i < 6; i += 1) button.fire("click", { detail: 0 });
  assert.deepEqual(actions, []);
});

test("pointer click during the hold, and keyboard click after keyup, still activate", () => {
  const { button, actions } = open(true);
  button.fire("click", { detail: 1 });
  assert.deepEqual(actions, ["go"]);
  windowListeners.keyup({ key: "Enter", keyCode: 13, preventDefault() {}, stopPropagation() {} });
  button.fire("click", { detail: 0 });
  assert.deepEqual(actions, ["go", "go"]);
});

test("dialogs that do not suppress Enter keep keyboard clicks", () => {
  const { button, actions } = open(false);
  button.fire("click", { detail: 0 });
  assert.deepEqual(actions, ["go"]);
});
