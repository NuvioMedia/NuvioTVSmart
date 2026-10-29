import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

function setup({ platform = "browser", constrained = false, legacyTizen = false } = {}) {
  const frames = new Map();
  let nextFrame = 0;
  const context = vm.createContext({
    internals: {
      getTvRuntimePerformanceProfile: () => ({ platform, isPerformanceConstrained: constrained }),
      MODERN_HOME_CONSTANTS: { springScrollStiffness: 100, springScrollDampingRatio: 1 }
    },
    document: {
      body: { classList: { contains: (name) => name === "legacy-tizen" && legacyTizen } }
    },
    performance: { now: () => 0 },
    requestAnimationFrame: (fn) => {
      frames.set(++nextFrame, fn);
      return nextFrame;
    },
    cancelAnimationFrame: (id) => frames.delete(id)
  });
  const screen = {};
  for (const [file, factory] of [
    ["homeScreenMethods-02-restore-modern-focus-state.js", "createHomeScreenMethods02"],
    ["homeScreenMethods-03-is-scroll-animation-active.js", "createHomeScreenMethods03"],
    ["homeScreenMethods-17-end-modern-vertical-fast-scroll.js", "createHomeScreenMethods17"]
  ]) {
    const source = readFileSync(new URL(`../js/ui/screens/home/${file}`, import.meta.url), "utf8")
      .replace(/^import .*;\n/m, "")
      .replace("export function", "function");
    Object.assign(screen, vm.runInContext(`${source}\n${factory}()`, context));
  }
  return { screen, frames, context };
}

for (const options of [
  { constrained: true },
  { platform: "tizen", legacyTizen: true },
  { platform: "webos" }
]) {
  test(`Home immediate policy cancels both cameras and clamps both axes: ${JSON.stringify(options)}`, () => {
    const { screen, frames, context } = setup(options);
    if (options.platform === "webos") {
      assert.equal(Boolean(screen.shouldUseImmediateFocusScroll()), false);
      assert.equal(screen.shouldUseImmediateCameraScroll(), true);
    }
    const container = {
      scrollWidth: 500,
      clientWidth: 100,
      scrollHeight: 800,
      clientHeight: 200,
      scrollLeft: 20,
      scrollTop: 30
    };
    for (const method of ["animateScroll", "animateSpringScroll"]) {
      for (const [axis, property, target, expected] of [
        ["x", "scrollLeft", 999, 400],
        ["y", "scrollTop", -25, 0]
      ]) {
        const tween = context.requestAnimationFrame(() => {});
        const spring = context.requestAnimationFrame(() => {});
        const otherAxis = context.requestAnimationFrame(() => {});
        const otherKey = axis === "x" ? "y" : "x";
        screen.scrollAnimations = new WeakMap([
          [container, { [axis]: tween, [otherKey]: otherAxis }]
        ]);
        screen.springScrollAnimations = new WeakMap([[container, { [axis]: { raf: spring } }]]);
        screen[method](container, axis, target);
        assert.equal(container[property], expected);
        assert.equal(frames.has(tween), false);
        assert.equal(frames.has(spring), false);
        assert.equal(frames.has(otherAxis), true);
        frames.clear();
      }
    }
    screen.animateScroll(container, "x", 127.6, 200, { mode: "spring" });
    assert.equal(container.scrollLeft, 128);
    assert.equal(frames.size, 0);
    screen.layoutMode = "modern";
    screen.container = { querySelector: () => container };
    assert.equal(screen.startModernVerticalFastScroll(1), false);
    assert.equal(frames.size, 0);
  });
}

for (const platform of ["tizen", "browser"]) {
  test(`Home retains animated scrolling and held navigation on normal ${platform}`, () => {
    const { screen, frames } = setup({ platform });
    const container = {
      scrollWidth: 500,
      clientWidth: 100,
      scrollHeight: 800,
      clientHeight: 200,
      scrollLeft: 0,
      scrollTop: 0
    };
    assert.equal(Boolean(screen.shouldUseImmediateCameraScroll()), false);
    for (const method of ["animateScroll", "animateSpringScroll"]) {
      screen[method](container, "x", 200);
      assert.equal(container.scrollLeft, 0);
      assert.equal(frames.size, 1);
      screen.cancelScrollAnimation(container, "x");
      assert.equal(frames.size, 0);
    }
    Object.assign(screen, {
      layoutMode: "modern",
      container: { querySelector: () => container },
      cancelModernCameraFollow() {},
      endModernVerticalFastScroll() {},
      armModernVerticalFastScrollEndTimer() {}
    });
    assert.equal(screen.startModernVerticalFastScroll(1), true);
    assert.equal(frames.size, 1);
    assert.equal(screen.modernVerticalFastScrollState.direction, 1);
  });
}
