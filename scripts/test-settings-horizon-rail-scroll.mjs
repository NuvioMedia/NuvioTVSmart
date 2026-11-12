import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Run the real rail scroll helper without the settings screen's browser bootstrap.
const source = readFileSync(
  new URL(
    "../js/ui/screens/settings/settingsScreenHelpers-09-update-settings-marquee-targets.js",
    import.meta.url
  ),
  "utf8"
)
  .replace(/^import[\s\S]*?;\r?\n/gm, "")
  .replace(/^export /gm, "");

function railFixture({ horizontal, scrollLeft = 0, scrollTop = 0, itemStart }) {
  const classes = new Set();
  const frame = {
    classList: {
      toggle(name, active) {
        if (active) classes.add(name);
        else classes.delete(name);
      }
    }
  };
  const rail = {
    clientWidth: 500,
    clientHeight: 300,
    scrollWidth: horizontal ? 1200 : 500,
    scrollHeight: horizontal ? 300 : 900,
    scrollLeft,
    scrollTop,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 500, bottom: 300 }),
    closest: (selector) => (selector === ".settings-sidebar-frame" ? frame : null)
  };
  const node = {
    offsetWidth: 120,
    offsetHeight: 88,
    closest: (selector) => (selector === ".settings-sidebar" ? rail : null),
    getBoundingClientRect: () =>
      horizontal
        ? { left: itemStart, top: 0, right: itemStart + 120, bottom: 88, width: 120, height: 88 }
        : { left: 0, top: itemStart, right: 120, bottom: itemStart + 88, width: 120, height: 88 }
  };
  return { rail, node, classes };
}

const { scrollSettingsRailItem } = new Function(
  "clamp",
  "SETTINGS_RAIL_SCROLL_TARGET_RATIO",
  "SETTINGS_RAIL_SCROLL_DAMPING_RATIO",
  "SETTINGS_RAIL_SCROLL_STIFFNESS",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  `${source}\nreturn { scrollSettingsRailItem };`
)((value, min, max) => Math.min(max, Math.max(min, value)), 0.42, 0.95, 180, undefined, undefined);

test("HORIZON rail scrolls a clipped tab into view and leaves visible tabs alone", () => {
  const clippedRight = railFixture({ horizontal: true, itemStart: 480 });
  scrollSettingsRailItem(clippedRight.node);
  assert.equal(clippedRight.rail.scrollLeft, 124);
  assert.equal(clippedRight.classes.has("can-scroll-backward"), true);
  assert.equal(clippedRight.classes.has("can-scroll-forward"), true);

  const visible = railFixture({ horizontal: true, scrollLeft: 50, itemStart: 100 });
  scrollSettingsRailItem(visible.node);
  assert.equal(visible.rail.scrollLeft, 50);

  const clippedLeft = railFixture({ horizontal: true, scrollLeft: 300, itemStart: -20 });
  scrollSettingsRailItem(clippedLeft.node);
  assert.equal(clippedLeft.rail.scrollLeft, 256);
});

test("vertical rail keeps its existing centred scroll", () => {
  const vertical = railFixture({ horizontal: false, itemStart: 280 });
  scrollSettingsRailItem(vertical.node);
  assert.equal(vertical.rail.scrollTop, 198);
  assert.equal(vertical.rail.scrollLeft, 0);
});

test("constrained sets snap the rail instead of running the spring", () => {
  const frames = [];
  const { scrollSettingsRailItem: scrollWithFrames } = new Function(
    "clamp",
    "SETTINGS_RAIL_SCROLL_TARGET_RATIO",
    "SETTINGS_RAIL_SCROLL_DAMPING_RATIO",
    "SETTINGS_RAIL_SCROLL_STIFFNESS",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    `${source}\nreturn { scrollSettingsRailItem };`
  )(
    (value, min, max) => Math.min(max, Math.max(min, value)),
    0.42,
    0.95,
    180,
    (callback) => frames.push(callback),
    () => {}
  );
  const previousDocument = globalThis.document;
  const setConstrained = (constrained) => {
    globalThis.document = {
      body: { classList: { contains: (name) => constrained && name === "performance-constrained" } }
    };
  };
  try {
    setConstrained(false);
    const animated = railFixture({ horizontal: true, itemStart: 480 });
    scrollWithFrames(animated.node);
    assert.equal(animated.rail.scrollLeft, 0, "the full profile starts a spring");
    assert.equal(frames.length > 0, true);

    frames.length = 0;
    setConstrained(true);
    const snapped = railFixture({ horizontal: true, itemStart: 480 });
    scrollWithFrames(snapped.node);
    assert.equal(snapped.rail.scrollLeft, 124);
    assert.equal(frames.filter((frame) => String(frame).includes("velocity")).length, 0);
  } finally {
    globalThis.document = previousDocument;
  }
});
