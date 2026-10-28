import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = readFileSync(
  new URL(
    "../js/ui/screens/detail/metaDetailsScreenMethods-22-get-horizontal-track-scroll-left.js",
    import.meta.url
  ),
  "utf8"
)
  .replace(/^import .*;\n/m, "")
  .replace("export function", "function");

function setup(platform, constrained = false) {
  class Element {
    constructor(names = []) {
      const classes = new Set(names);
      this.classList = {
        contains: (name) => classes.has(name),
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name)
      };
      this.dataset = {};
    }
  }
  const calls = [];
  const context = {
    HTMLElement: Element,
    getComputedStyle: () => ({ paddingLeft: "20px" }),
    internals: {
      DETAIL_ROW_FOCUS_TARGET: 0.25,
      ScreenUtils: { shouldSkipRouteEnter: () => constrained || platform === "tizen" },
      getTvRuntimePerformanceProfile: () => ({ platform })
    }
  };
  const screen = vm.runInNewContext(`${source}\ncreateMetaDetailsScreenMethods22()`, context);
  const track = Object.assign(new Element(["series-episode-track"]), {
    scrollLeft: 0,
    scrollWidth: 600,
    clientWidth: 200,
    contains: (node) => cards.includes(node),
    matches: () => false,
    getBoundingClientRect: () => ({ top: 2000 })
  });
  const content = {
    scrollTop: 40,
    scrollHeight: 1200,
    clientHeight: 200,
    contains: (node) => node === track,
    getBoundingClientRect: () => ({ top: 100 })
  };
  const cards = [20, 700].map((offsetLeft) =>
    Object.assign(new Element(), {
      offsetLeft,
      closest: (selector) => (selector.includes(".series-episode-track") ? track : null),
      focus: (options) => calls.push(["focus", options.preventScroll])
    })
  );
  Object.assign(screen, {
    container: {
      querySelector: () => cards.find((card) => card.classList.contains("focused")),
      querySelectorAll: () => cards.filter((card) => card.classList.contains("focused"))
    },
    getDetailContentScroller: () => content,
    rememberEpisodeFocus: (target) => calls.push(["remember", target]),
    rememberRailFocus() {},
    syncEpisodeTitleMarquee() {},
    syncDetailScrollBounds: () => calls.push(["bounds"]),
    animateScroll: (container, axis, value, duration) =>
      calls.push(["animate", axis, value, duration]),
    extendRailWindowIfNeeded: (target) => calls.push(["extend", target])
  });
  return { screen, cards, track, content, calls };
}

for (const [platform, constrained] of [
  ["webos", false],
  ["tizen", false],
  ["browser", true]
]) {
  test(`${platform} detail rails use native bounds and preserve same-rail vertical position`, () => {
    const { screen, cards, track, content, calls } = setup(platform, constrained);
    assert.equal(screen.focusInList(cards, 999), true);
    assert.equal(cards[1].classList.contains("focused"), true);
    assert.equal(track.scrollLeft, 400);
    assert.equal(content.scrollTop, 1000);
    assert.equal(
      calls.some(([name]) => name === "animate"),
      false
    );
    assert.equal(
      calls.some(([name, preventScroll]) => name === "focus" && preventScroll),
      true
    );
    assert.equal(
      calls.some(([name, target]) => name === "remember" && target === cards[1]),
      true
    );
    assert.equal(
      calls.some(([name, target]) => name === "extend" && target === cards[1]),
      true
    );
    content.scrollTop = 123;
    assert.equal(screen.focusInList(cards, -99), true);
    assert.equal(track.scrollLeft, 0);
    assert.equal(content.scrollTop, 123);
    assert.equal(cards[1].classList.contains("focused"), false);
    assert.equal(screen.focusInList([], 0), false);
  });
}

test("browser detail scrolling remains animated unless explicitly disabled", () => {
  const { screen, cards, content, calls } = setup("browser");
  screen.focusInList(cards, 1);
  assert.deepEqual(
    calls.filter(([name]) => name === "animate"),
    [
      ["animate", "x", 400, 260],
      ["animate", "y", 1890, 280]
    ]
  );
  assert.equal(content.scrollTop, 40);
  const explicit = setup("browser");
  explicit.screen.focusInList(explicit.cards, 1, { animated: false, preserveVerticalScroll: true });
  assert.equal(explicit.track.scrollLeft, 400);
  assert.equal(explicit.content.scrollTop, 40);
  assert.equal(
    explicit.calls.some(([name]) => name === "animate"),
    false
  );
});
