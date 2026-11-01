import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

function setup({ platform = "browser", constrained = false, bodyConstrained = false } = {}) {
  const frames = new Map();
  let nextFrame = 0;
  let now = 1000;
  const classList = { contains: (name) => name === "performance-constrained" && bodyConstrained };
  const internals = {
    getTvRuntimePerformanceProfile: () => ({ platform, isPerformanceConstrained: constrained }),
    MODERN_HOME_CONSTANTS: { springScrollStiffness: 100, springScrollDampingRatio: 1 },
    Platform: { isBackEvent: () => false },
    isUpKey: (event) => event.keyCode === 38,
    isDownKey: (event) => event.keyCode === 40,
    isLeftKey: (event) => event.keyCode === 37,
    isRightKey: (event) => event.keyCode === 39,
    isEnterKey: (event) => event.keyCode === 13
  };
  const context = vm.createContext({
    internals,
    getTvRuntimePerformanceProfile: internals.getTvRuntimePerformanceProfile,
    document: { body: { classList } },
    Date: { now: () => now },
    performance: { now: () => now },
    requestAnimationFrame: (fn) => {
      frames.set(++nextFrame, fn);
      return nextFrame;
    },
    cancelAnimationFrame: (id) => frames.delete(id)
  });
  const searchSource = readFileSync(
    new URL("../js/ui/screens/search/searchScreen.js", import.meta.url),
    "utf8"
  );
  internals.isPerformanceConstrainedRuntime = vm.runInContext(
    `${searchSource.match(/function isPerformanceConstrainedRuntime\(\) \{[\s\S]*?\n\}/)[0]}; isPerformanceConstrainedRuntime`,
    context
  );
  const throttle = readFileSync(
    new URL("../js/ui/navigation/dpadRepeatThrottle.js", import.meta.url),
    "utf8"
  ).replaceAll("export function", "function");
  Object.assign(
    internals,
    vm.runInContext(`${throttle}\n({allowDpadRepeat, resetDpadRepeat})`, context)
  );
  function load(file, factory) {
    const source = readFileSync(new URL(`../js/ui/screens/search/${file}`, import.meta.url), "utf8")
      .replace(/^import .*;\n/gm, "")
      .replace("export function", "function");
    return vm.runInContext(`${source}\n${factory}()`, context);
  }
  return {
    search: load("searchScreenMethods-04-open-sidebar.js", "createSearchScreenMethods04"),
    discover: {
      ...load("discoverScreenMethods-04-restore-focused-card.js", "createDiscoverScreenMethods04"),
      ...load("discoverScreenMethods-06-bind-card-events.js", "createDiscoverScreenMethods06")
    },
    frames,
    context,
    advance: (ms) => {
      now += ms;
    }
  };
}

for (const options of [{ constrained: true }, { bodyConstrained: true }]) {
  test(`Search cancels both cameras and clamps targets with ${JSON.stringify(options)}`, () => {
    const { search, frames, context } = setup(options);
    const container = {
      scrollWidth: 500,
      clientWidth: 100,
      scrollHeight: 800,
      clientHeight: 200,
      scrollLeft: 0,
      scrollTop: 0
    };
    for (const method of ["animateScroll", "animateSpringScroll"]) {
      for (const [axis, property, target, expected] of [
        ["x", "scrollLeft", 999, 400],
        ["y", "scrollTop", -25, 0]
      ]) {
        const tween = context.requestAnimationFrame(() => {});
        const spring = context.requestAnimationFrame(() => {});
        const other = context.requestAnimationFrame(() => {});
        search.scrollAnimations = new WeakMap([
          [container, { [axis]: tween, [axis === "x" ? "y" : "x"]: other }]
        ]);
        search.springScrollAnimations = new WeakMap([[container, { [axis]: { raf: spring } }]]);
        search[method](container, axis, target);
        assert.equal(container[property], expected);
        assert.equal(frames.has(tween), false);
        assert.equal(frames.has(spring), false);
        assert.equal(frames.has(other), true);
        frames.clear();
      }
    }
    search.animateScroll(container, "x", 127.6, 200, { mode: "spring" });
    assert.equal(container.scrollLeft, 128);
    assert.equal(frames.size, 0);
  });

  test(`Discover steps the same column with bounded repeats instead of fast scroll: ${JSON.stringify(options)}`, async () => {
    const { discover, frames, advance } = setup(options);
    const card = (row, col) => ({
      dataset: {
        navRow: String(row),
        navCol: String(col),
        action: "openDetail",
        itemId: `${row}:${col}`
      }
    });
    const rows = [
      [card(0, 0), card(0, 1)],
      [card(1, 0), card(1, 1)],
      [card(2, 0), card(2, 1)]
    ];
    let focused = rows[0][1];
    let moves = 0;
    Object.assign(discover, {
      container: { querySelector: () => focused },
      getContentScroller: () => ({}),
      navModel: { rows },
      focusZone: "content",
      layoutPrefs: {},
      getKindFromFilterAction: () => null,
      focusNode: (target) => {
        focused = target;
        moves++;
        return true;
      }
    });
    const down = { keyCode: 40, repeat: true, preventDefault() {} };
    await discover.onKeyDown(down);
    assert.equal(focused, rows[1][1]);
    assert.equal(frames.size, 0);
    advance(30);
    await discover.onKeyDown(down);
    assert.equal(moves, 1);
    advance(200);
    await discover.onKeyDown(down);
    assert.equal(focused, rows[2][1]);
    advance(200);
    await discover.onKeyDown(down);
    assert.equal(moves, 2);
    discover.onKeyUp({ keyCode: 40 });
    assert.equal(frames.size, 0);
  });
}

for (const platform of ["webos", "tizen", "browser"]) {
  test(`Normal ${platform} retains Search animations and Discover fast scroll`, () => {
    const { search, discover, frames } = setup({ platform });
    const container = {
      scrollWidth: 500,
      clientWidth: 100,
      scrollHeight: 800,
      clientHeight: 200,
      scrollLeft: 0,
      scrollTop: 0
    };
    assert.equal(search.shouldUseImmediateFocusScroll(), false);
    assert.equal(discover.shouldUseImmediateFocusScroll(), false);
    for (const method of ["animateScroll", "animateSpringScroll"]) {
      search[method](container, "x", 200);
      assert.equal(container.scrollLeft, 0);
      assert.equal(frames.size, 1);
      search.cancelScrollAnimation(container, "x");
    }
    Object.assign(discover, {
      container: { querySelector: () => ({ dataset: { navCol: "1" } }) },
      getContentScroller: () => container,
      endDiscoverVerticalFastScroll() {},
      armDiscoverVerticalFastScrollEndTimer() {}
    });
    assert.equal(discover.startDiscoverVerticalFastScroll(1), true);
    assert.equal(frames.size, 1);
    assert.equal(discover.discoverVerticalFastScrollState.startColumn, 1);
  });
}
