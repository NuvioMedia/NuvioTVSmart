import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = (await readFile(new URL("./nuvioDialog.js", import.meta.url), "utf8"))
  .replace(/^import [\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, "")
  .replace(/^export /gm, "");

function fakeEl() {
  const listeners = {};
  const classes = new Set();
  return {
    dataset: {},
    style: {},
    children: [],
    listeners,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
      contains: (c) => classes.has(c)
    },
    appendChild(c) {
      this.children.push(c);
      return c;
    },
    addEventListener: (name, fn) => (listeners[name] = fn),
    setAttribute() {}
  };
}

test("pointer entering a dialog button moves the highlight to it", () => {
  const document = {
    createElement: fakeEl,
    createElementNS: fakeEl,
    createTextNode: () => fakeEl(),
    addEventListener() {},
    body: Object.assign(fakeEl(), { classList: fakeEl().classList })
  };
  const context = vm.createContext({
    document,
    window: { addEventListener() {} },
    focusWithoutScroll() {},
    requestAnimationFrame() {}
  });
  vm.runInContext(`${source}\nglobalThis.NuvioDialog = NuvioDialog;`, context);
  const dialog = new context.NuvioDialog({
    title: "t",
    buttons: [{ label: "a" }, { label: "b" }, { label: "c" }]
  });
  dialog.mount(fakeEl());
  dialog._buttonEls[2].listeners.mouseenter();
  assert.equal(dialog._focusedIndex, 2);
  assert.ok(dialog._buttonEls[2].classList.contains("focused"));
  assert.ok(!dialog._buttonEls[0].classList.contains("focused"));
});
