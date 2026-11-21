import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const strip = (source) => source.replace(/^import [\s\S]*?;$/gm, "").replace(/^export /gm, "");

const source05 = strip(
  await readFile(new URL("./homeScreenMethods-05-apply-hero-to-dom.js", import.meta.url), "utf8")
);

test("applyHeroToDom replaces div placeholder with img and animates backdrop swap when src arrives", () => {
  const registered = [];
  const swapped = [];
  class FakeImg {
    constructor(tag = "img") {
      this.tagName = tag.toUpperCase();
      this.attrs = {};
      this.className = "";
      this.classList = { add() {}, remove() {}, toggle() {} };
    }
    setAttribute(k, v) {
      this.attrs[k] = String(v);
    }
    getAttribute(k) {
      return this.attrs[k] ?? null;
    }
  }
  const placeholderDiv = {
    tagName: "DIV",
    className: "home-hero-backdrop placeholder",
    parentNode: null,
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {},
    removeAttribute() {}
  };
  const wrap = {
    children: [placeholderDiv],
    replaceChild(nextNode, oldNode) {
      const idx = this.children.indexOf(oldNode);
      assert.notEqual(idx, -1);
      this.children[idx] = nextNode;
      nextNode.parentNode = this;
      oldNode.parentNode = null;
    }
  };
  placeholderDiv.parentNode = wrap;

  const heroNode = {
    dataset: {},
    classList: { toggle() {}, remove() {} },
    querySelectorAll: () => [],
    querySelector: (selector) =>
      selector === ".home-hero-backdrop:not(.home-hero-backdrop-transition-ghost)"
        ? wrap.children[0]
        : null
  };

  const context = vm.createContext({
    HTMLImageElement: FakeImg,
    document: { createElement: (tag) => new FakeImg(tag) },
    ensureHeroMdbListRatings: () => {},
    registerHomeDomNodes: (nodes) => registered.push(...nodes),
    createHeroDescriptionAutoScroller: () => ({ apply() {}, stop() {} }),
    internals: {
      getTvHeroTransitionMode: () => "crossfade",
      focusWithoutAutoScroll: () => {},
      setLegacySidebarExpanded: () => {},
      HOME_LEGACY_HERO_BACKDROP_CROSSFADE_MS: 200,
      HOME_MODERN_HERO_BACKDROP_CROSSFADE_MS: 200,
      escapeHtml: (v) => String(v || ""),
      animateHeroBackdropSwap: (el, src) => swapped.push({ el, src }),
      animateHeroLogoSwap: () => {},
      normalizeHomeRowItem: (x) => x,
      normalizeContinueWatchingItem: (x) => x,
      buildHeroDisplayModel: () => ({
        title: "Film",
        backdrop: "https://img.example/bg.jpg",
        logo: null,
        metaPrimary: [],
        metaSecondary: [],
        chips: [],
        description: "",
        mdbListMarkup: ""
      }),
      buildModernHeroPresentation: () => null,
      renderModernHeroPrimary: () => "",
      renderModernHeroSecondary: () => "",
      renderMetaTokens: () => "",
      buildHeroIndicators: () => ""
    }
  });
  context.globalThis = context;
  vm.runInContext(`${source05}\nglobalThis.api = createHomeScreenMethods05();`, context);

  const screen = Object.assign(Object.create(context.api), {
    layoutMode: "legacy",
    heroItem: { id: "tt1", type: "movie", name: "Film" },
    heroCandidates: [],
    container: {
      querySelector: (sel) => (sel === ".home-hero-card" ? heroNode : null)
    },
    ensureHeroTrailerLayerMounted() {},
    scheduleHomeTruncationUpdate() {},
    syncCollectionHeroMedia() {},
    applyHeroDescriptionAutoScroll() {},
    scheduleHeroTrailerStart() {},
    hasHeroFocus() {
      return false;
    }
  });

  screen.applyHeroToDom();
  assert.ok(wrap.children[0] instanceof FakeImg, "div placeholder must be replaced with <img>");
  assert.equal(registered.length, 1);
  assert.deepEqual(swapped, [{ el: wrap.children[0], src: "https://img.example/bg.jpg" }]);
});
