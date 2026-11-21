import assert from "node:assert/strict";
import test from "node:test";
import { fitSidebarLabel } from "./sidebarNavigationHelpers-01-root-sidebar-items.js";

test("fitSidebarLabel caches repeated non-empty labels to skip binary-search layout reads", () => {
  const prevGetComputedStyle = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => ({ fontSize: "36px" });
  try {
    let scrollReads = 0;
    const makeNode = (text, width = 100) => ({
      isConnected: true,
      className: "modern-sidebar-nav-label",
      textContent: text,
      style: { fontSize: "" },
      clientWidth: Math.round(width),
      getBoundingClientRect: () => ({ width }),
      get scrollWidth() {
        scrollReads += 1;
        const size = Number.parseFloat(this.style.fontSize) || 36;
        return Math.round(size * 4);
      }
    });

    const node1 = makeNode("SettingsLabel");
    assert.equal(fitSidebarLabel(node1, 14), true);
    const readsAfterFirst = scrollReads;
    assert.equal(readsAfterFirst > 1, true);

    assert.equal(fitSidebarLabel(node1, 14), true);
    assert.equal(scrollReads, readsAfterFirst, "repeat call on same node skips binary search");

    const node2 = makeNode("SettingsLabel");
    assert.equal(fitSidebarLabel(node2, 14), true);
    assert.equal(node2.style.fontSize, node1.style.fontSize);
    assert.equal(scrollReads, readsAfterFirst, "matching label+width hits shared cache");

    const narrower = makeNode("SettingsLabel", 99.9);
    assert.equal(fitSidebarLabel(narrower, 14), true);
    assert.notEqual(scrollReads, readsAfterFirst, "a different slot width is measured again");
    assert.ok(
      Number.parseFloat(narrower.style.fontSize) <= Number.parseFloat(node1.style.fontSize),
      "a narrower slot never reuses the wider fit"
    );
  } finally {
    globalThis.getComputedStyle = prevGetComputedStyle;
  }
});
