import assert from "node:assert/strict";
import test from "node:test";

class FakeNode {
  constructor(classes, index, rect) {
    this.classes = new Set(classes);
    this.dataset = { index: String(index) };
    this.rect = rect;
    this.classList = {
      add: (c) => this.classes.add(c),
      remove: (c) => this.classes.delete(c),
      contains: (c) => this.classes.has(c)
    };
  }
  matchesSimple(sel) {
    return sel
      .split(".")
      .map((s) => s.trim())
      .filter(Boolean)
      .every((c) => this.classes.has(c));
  }
  matches(selector) {
    return String(selector)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .some((part) => this.matchesSimple(part));
  }
  getBoundingClientRect() {
    return this.rect;
  }
  focus() {}
}

globalThis.document = { body: { classList: { contains: () => false } } };

const { ScreenUtils } = await import("./screen.js");

test("ScreenUtils.moveFocus and moveFocusDirectional find .focused correctly with comma-separated selectors", () => {
  const elA = new FakeNode(["a"], 0, { left: 0, top: 0, width: 100, height: 40 });
  const elB = new FakeNode(["b", "focused"], 1, { left: 150, top: 0, width: 100, height: 40 });
  const elC = new FakeNode(["b"], 2, { left: 300, top: 0, width: 100, height: 40 });
  const nodes = [elA, elB, elC];
  const container = {
    querySelectorAll: (sel) => nodes.filter((n) => n.matches(sel)),
    querySelector: (sel) => nodes.find((n) => n.matches(sel)) || null
  };

  ScreenUtils.moveFocus(container, 1, ".a, .b");
  assert.equal(elC.classList.contains("focused"), true);
  assert.equal(elB.classList.contains("focused"), false);

  ScreenUtils.moveFocusDirectional(container, "left", ".a, .b");
  assert.equal(elB.classList.contains("focused"), true);
  assert.equal(elC.classList.contains("focused"), false);
});
