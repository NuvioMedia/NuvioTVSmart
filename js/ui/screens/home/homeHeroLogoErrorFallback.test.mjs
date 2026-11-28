import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

if (!globalThis.localStorage) {
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  };
}

const { renderModernHomeLayout } = await import("./modernHomeLayout.js");
const homeImageHelpers = await import("./homeImageHelpers.js");

const strip = (source) => source.replace(/^import [\s\S]*?;$/gm, "").replace(/^export /gm, "");

const helpers02Source = await readFile(
  new URL("./homeScreenHelpers-02-extract-release-date-text.js", import.meta.url),
  "utf8"
);
const logoSwapSource = await readFile(
  new URL("./homeScreenHelpers-04-animate-hero-logo-swap.js", import.meta.url),
  "utf8"
);
const source05 = strip(
  await readFile(new URL("./homeScreenMethods-05-apply-hero-to-dom.js", import.meta.url), "utf8")
);
const indicatorsSource = strip(
  await readFile(
    new URL("./homeScreenHelpers-12-build-hero-indicators.js", import.meta.url),
    "utf8"
  )
);

function createBrandHarness() {
  const rafQueue = [];
  const flushRafs = async () => {
    while (rafQueue.length) {
      const batch = rafQueue.splice(0);
      batch.forEach((cb) => cb?.());
      await new Promise((r) => setTimeout(r, 0));
    }
  };

  class FakeElement {
    constructor(tagName = "div") {
      this.tagName = String(tagName).toUpperCase();
      this.attributes = {};
      this.dataset = {};
      this.textContent = "";
      this.hidden = false;
      this.complete = false;
      this.naturalWidth = 0;
      const tokens = new Set();
      this.classList = {
        add: (...names) => names.forEach((n) => n && tokens.add(n)),
        remove: (...names) => names.forEach((n) => tokens.delete(n)),
        toggle: (n, force) => {
          if (force === undefined) {
            if (tokens.has(n)) tokens.delete(n);
            else tokens.add(n);
            return tokens.has(n);
          }
          if (force) tokens.add(n);
          else tokens.delete(n);
          return Boolean(force);
        },
        contains: (n) => tokens.has(n),
        has: (n) => tokens.has(n)
      };
      const props = {};
      this.style = {
        getPropertyValue: (name) => props[name] || "",
        getPropertyPriority: () => "",
        setProperty: (name, value) => {
          props[name] = String(value);
        },
        removeProperty: (name) => {
          delete props[name];
        },
        props
      };
      this.children = [];
      this.parentElement = null;
      this.parentNode = null;
    }
    set className(value) {
      String(value || "")
        .split(/\s+/)
        .filter(Boolean)
        .forEach((n) => this.classList.add(n));
    }
    get firstChild() {
      return this.children[0] || null;
    }
    getAttribute(name) {
      return name in this.attributes ? this.attributes[name] : null;
    }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }
    removeAttribute(name) {
      delete this.attributes[name];
    }
    cloneNode() {
      const clone = new this.constructor(this.tagName);
      Object.assign(clone.attributes, this.attributes);
      return clone;
    }
    appendChild(child) {
      child.parentElement = this;
      child.parentNode = this;
      this.children.push(child);
      return child;
    }
    insertBefore(child, ref) {
      child.parentElement = this;
      child.parentNode = this;
      const idx = ref ? this.children.indexOf(ref) : -1;
      if (idx === -1) {
        this.children.push(child);
      } else {
        this.children.splice(idx, 0, child);
      }
      return child;
    }
    remove() {
      if (this.parentElement) {
        this.parentElement.children = this.parentElement.children.filter((c) => c !== this);
        this.parentElement = null;
        this.parentNode = null;
      }
    }
    querySelectorAll(selector) {
      const cls = selector.startsWith(".") ? selector.slice(1) : selector;
      return this.children.filter((node) => node.classList.contains(cls));
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }
  }
  class FakeImage extends FakeElement {}

  const prepareStart = helpers02Source.indexOf("export function prepareHeroImageEnter");
  const helperCode = strip(helpers02Source.slice(prepareStart));

  const preloadQueue = new Map();
  const context = vm.createContext({
    HTMLImageElement: FakeImage,
    HOME_MODERN_HERO_BACKDROP_CROSSFADE_MS: 10,
    document: { createElement: (tag) => new FakeImage(tag) },
    requestAnimationFrame: (cb) => rafQueue.push(cb),
    setTimeout,
    clearTimeout,
    preloadHeroLogo: (src) => preloadQueue.get(src)?.() || Promise.resolve({ loaded: true, src }),
    shouldRescaleHeroLogo: () => false
  });
  context.globalThis = context;
  vm.runInContext(
    [
      helperCode,
      strip(logoSwapSource.slice(logoSwapSource.indexOf("export function animateHeroLogoSwap")))
    ].join("\n"),
    context
  );

  return { FakeElement, FakeImage, context, preloadQueue, flushRafs };
}

test("animateHeroLogoSwap hides broken logo and reveals hero title when preload fails", async () => {
  const { FakeElement, FakeImage, context, preloadQueue, flushRafs } = createBrandHarness();

  const brand = new FakeElement("div");
  brand.classList.add("home-hero-brand");
  const logo = new FakeImage("img");
  logo.classList.add("home-hero-logo");
  const title = new FakeElement("h1");
  title.classList.add("home-hero-title-text", "is-hidden");
  title.textContent = "🇪🇸  Spanish";
  brand.appendChild(logo);
  brand.appendChild(title);

  preloadQueue.set("https://cdn.example/broken-spanish.png", () =>
    Promise.resolve({ loaded: false, src: "https://cdn.example/broken-spanish.png" })
  );

  context.animateHeroLogoSwap(logo, "https://cdn.example/broken-spanish.png", "🇪🇸  Spanish", 10);
  await new Promise((r) => setTimeout(r, 0));
  await flushRafs();

  assert.equal(logo.hidden, true, "failed logo must set hidden=true");
  assert.equal(
    logo.style.getPropertyValue("display"),
    "none",
    "failed logo must set inline display:none to override .home-hero-logo display:block"
  );
  assert.equal(
    title.classList.contains("is-hidden"),
    false,
    "fallback title must be revealed when logo fails to load"
  );
});

test("animateHeroLogoSwap reveals logo on late onload and ignores stale token error/load callbacks", async () => {
  const { FakeElement, FakeImage, context, preloadQueue, flushRafs } = createBrandHarness();

  const brand = new FakeElement("div");
  brand.classList.add("home-hero-brand");
  const logo = new FakeImage("img");
  logo.classList.add("home-hero-logo");
  const title = new FakeElement("h1");
  title.classList.add("home-hero-title-text", "is-hidden");
  title.textContent = "Slow Movie";
  brand.appendChild(logo);
  brand.appendChild(title);

  preloadQueue.set("https://cdn.example/slow-logo.png", () =>
    Promise.resolve({ loaded: false, src: "https://cdn.example/slow-logo.png" })
  );

  context.animateHeroLogoSwap(logo, "https://cdn.example/slow-logo.png", "Slow Movie", 10);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(logo.hidden, true);
  assert.equal(title.classList.contains("is-hidden"), false);

  const slowOnload = logo.onload;
  assert.equal(typeof slowOnload, "function");
  logo.naturalWidth = 400;
  logo.complete = true;
  slowOnload();

  assert.equal(logo.hidden, false, "late onload for active token must restore logo");
  assert.equal(logo.style.getPropertyValue("display"), "");
  assert.equal(title.classList.contains("is-hidden"), true, "title hides once logo loads");

  // Start a newer swap whose preload succeeds; firing the stale handler must be ignored.
  preloadQueue.set("https://cdn.example/next-logo.png", () =>
    Promise.resolve({ loaded: true, src: "https://cdn.example/next-logo.png" })
  );
  title.textContent = "Next Movie";
  context.animateHeroLogoSwap(logo, "https://cdn.example/next-logo.png", "Next Movie", 10);
  await new Promise((r) => setTimeout(r, 0));
  await flushRafs();

  slowOnload();
  assert.equal(logo.getAttribute("src"), "https://cdn.example/next-logo.png");
  assert.equal(logo.hidden, false);
  assert.equal(title.classList.contains("is-hidden"), true);
});

test("animateHeroLogoSwap falls back immediately on re-applied already-broken img", () => {
  const { FakeElement, FakeImage, context } = createBrandHarness();

  const brand = new FakeElement("div");
  brand.classList.add("home-hero-brand");
  const logo = new FakeImage("img");
  logo.classList.add("home-hero-logo");
  logo.setAttribute("src", "https://cdn.example/dead.png");
  logo.heroLogoSourceUrl = "https://cdn.example/dead.png";
  logo.complete = true;
  logo.naturalWidth = 0;

  const title = new FakeElement("h1");
  title.classList.add("home-hero-title-text", "is-hidden");
  title.textContent = "Spanish";
  brand.appendChild(logo);
  brand.appendChild(title);

  context.animateHeroLogoSwap(logo, "https://cdn.example/dead.png", "Spanish", 10);

  assert.equal(logo.hidden, true);
  assert.equal(logo.style.getPropertyValue("display"), "none");
  assert.equal(title.classList.contains("is-hidden"), false);
});

test("collection folder with empty title (hideTitle) hides broken logo and keeps title hidden without Untitled", async () => {
  const { FakeElement, FakeImage, context, preloadQueue } = createBrandHarness();

  const brand = new FakeElement("div");
  brand.classList.add("home-hero-brand");
  const logo = new FakeImage("img");
  logo.classList.add("home-hero-logo");
  const title = new FakeElement("h1");
  title.classList.add("home-hero-title-text", "is-hidden");
  title.textContent = "";
  brand.appendChild(logo);
  brand.appendChild(title);

  preloadQueue.set("https://cdn.example/dead-hidden.png", () =>
    Promise.resolve({ loaded: false, src: "https://cdn.example/dead-hidden.png" })
  );

  context.animateHeroLogoSwap(logo, "https://cdn.example/dead-hidden.png", "logo", 10);
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(logo.hidden, true);
  assert.equal(logo.style.getPropertyValue("display"), "none");
  assert.equal(title.classList.contains("is-hidden"), true, "empty title stays hidden");
});

test("renderModernHomeLayout and renderHeroMarkup attach onerror fallback and hide empty title", () => {
  assert.equal(
    typeof homeImageHelpers.buildHeroLogoErrorHandler,
    "function",
    "homeImageHelpers must export buildHeroLogoErrorHandler"
  );

  const modern = renderModernHomeLayout({
    rows: [],
    heroItem: { id: "col_1", type: "collection_folder", name: "Spanish" },
    heroCandidates: [],
    showHeroSection: true,
    buildModernHeroPresentation: () => ({
      title: "🇪🇸  Spanish",
      logo: "https://cdn.example/spanish-logo.png",
      description: "",
      backdrop: "",
      leadingMeta: [],
      trailingMeta: [],
      secondaryHighlightText: "",
      badges: [],
      languageText: "",
      showImdbPrimary: false,
      showImdbSecondary: false,
      imdbText: ""
    }),
    renderContinueWatchingSection: () => "",
    createPosterCardMarkup: () => "",
    createSeeAllCardMarkup: () => "",
    formatCatalogRowTitle: (x) => x,
    escapeHtml: (v) => String(v ?? ""),
    escapeAttribute: (v) => String(v ?? "")
  });

  assert.match(modern.markup, /<img class="home-hero-logo"[^>]+onerror="/);

  const modernHiddenTitle = renderModernHomeLayout({
    rows: [],
    heroItem: { id: "col_2", type: "collection_folder", name: "" },
    heroCandidates: [],
    showHeroSection: true,
    buildModernHeroPresentation: () => ({
      title: "",
      logo: "",
      description: "",
      backdrop: "",
      leadingMeta: [],
      trailingMeta: [],
      secondaryHighlightText: "",
      badges: [],
      languageText: "",
      showImdbPrimary: false,
      showImdbSecondary: false,
      imdbText: ""
    }),
    renderContinueWatchingSection: () => "",
    createPosterCardMarkup: () => "",
    createSeeAllCardMarkup: () => "",
    formatCatalogRowTitle: (x) => x,
    escapeHtml: (v) => String(v ?? ""),
    escapeAttribute: (v) => String(v ?? "")
  });

  assert.match(modernHiddenTitle.markup, /<h1 class="home-hero-title-text is-hidden"><\/h1>/);

  // Also test renderHeroMarkup (classic / grid layout)
  const indCtx = vm.createContext({
    LayoutPreferences: { get: () => ({}) },
    showHomeRatings: () => false,
    renderHeroMdbListRatings: () => "",
    continueWatchingRating: () => null,
    resolveImdbRating: () => null,
    localizedGenreLabel: (g) => g,
    formatContentTypeLabel: (t) => t,
    isCollectionFolderItem: () => true,
    normalizeCollectionFolderItem: (x) => x,
    buildHeroBackdropSources: () => [],
    encodeHeroBackdropFallbacks: () => "",
    buildImageFallbackErrorHandler: homeImageHelpers.buildImageFallbackErrorHandler,
    buildHeroLogoErrorHandler: homeImageHelpers.buildHeroLogoErrorHandler,
    buildHeroDisplayModel: () => ({
      title: "🇪🇸  Spanish",
      logo: "https://cdn.example/spanish-logo.png",
      backdrop: "",
      backdropFallbacks: [],
      metaPrimary: [],
      metaSecondary: [],
      chips: [],
      description: " ",
      mdbListMarkup: ""
    }),
    renderHeroBackdropImage: () => "",
    renderMetaTokens: () => "",
    buildHeroIndicators: () => "",
    escapeHtml: (v) => String(v ?? ""),
    escapeAttribute: (v) => String(v ?? ""),
    firstNonEmpty: (...vals) => vals.find((v) => v != null && String(v).trim() !== "") || ""
  });
  const fnStart =
    indicatorsSource.indexOf("export function renderHeroMarkup") === -1
      ? indicatorsSource.indexOf("function renderHeroMarkup")
      : indicatorsSource.indexOf("export function renderHeroMarkup");
  const fnEnd = indicatorsSource.indexOf("function buildPosterSubtitle");
  vm.runInContext(indicatorsSource.slice(fnStart, fnEnd), indCtx);

  const classicMarkup = indCtx.renderHeroMarkup(
    "classic",
    { id: "col_1", type: "collection_folder", name: "Spanish" },
    []
  );
  assert.match(classicMarkup, /<img class="home-hero-logo"[^>]+onerror="/);
});

test("applyHeroToDom updates title before swap, preserves empty title, and hides freshly inserted logo until loaded", () => {
  const { FakeElement, FakeImage } = createBrandHarness();
  const observedAtSwap = [];

  const brandNode = new FakeElement("div");
  brandNode.classList.add("home-hero-brand");
  const titleNode = new FakeElement("h1");
  titleNode.classList.add("home-hero-title-text");
  titleNode.textContent = "Old Movie";
  brandNode.appendChild(titleNode);

  const heroNode = new FakeElement("article");
  heroNode.classList.add("home-hero-card");
  heroNode.querySelector = (sel) => {
    if (sel === ".home-hero-brand") return brandNode;
    if (sel === ".home-hero-title-text") return titleNode;
    if (sel === ".home-hero-logo:not(.home-hero-logo-transition-ghost)") {
      return (
        brandNode.children.find(
          (c) =>
            c.classList.contains("home-hero-logo") &&
            !c.classList.contains("home-hero-logo-transition-ghost")
        ) || null
      );
    }
    return null;
  };
  heroNode.querySelectorAll = () => [];

  let currentDisplay = {
    title: "🇪🇸  Spanish",
    logo: "https://cdn.example/spanish.png",
    backdrop: "",
    leadingMeta: [],
    trailingMeta: [],
    secondaryHighlightText: "",
    badges: [],
    languageText: "",
    showImdbPrimary: false,
    showImdbSecondary: false,
    imdbText: "",
    description: ""
  };

  const context = vm.createContext({
    HTMLImageElement: FakeImage,
    document: { createElement: (tag) => new FakeImage(tag) },
    ensureHeroMdbListRatings: () => {},
    registerHomeDomNodes: () => {},
    createHeroDescriptionAutoScroller: () => ({ apply() {}, stop() {} }),
    internals: {
      getTvHeroTransitionMode: () => "crossfade",
      focusWithoutAutoScroll: () => {},
      setLegacySidebarExpanded: () => {},
      HOME_LEGACY_HERO_BACKDROP_CROSSFADE_MS: 200,
      HOME_MODERN_HERO_BACKDROP_CROSSFADE_MS: 200,
      escapeHtml: (v) => String(v || ""),
      animateHeroBackdropSwap: () => {},
      animateHeroLogoSwap: (logoEl) => {
        observedAtSwap.push({
          titleTextAtSwap: titleNode.textContent,
          logoHiddenAtSwap: logoEl.hidden,
          logoDisplayAtSwap: logoEl.style.getPropertyValue("display")
        });
      },
      normalizeHomeRowItem: (x) => x,
      normalizeContinueWatchingItem: (x) => x,
      buildHeroDisplayModel: () => currentDisplay,
      buildModernHeroPresentation: () => currentDisplay,
      renderModernHeroPrimary: () => "",
      renderModernHeroSecondary: () => "",
      renderMetaTokens: () => "",
      buildHeroIndicators: () => ""
    }
  });
  context.globalThis = context;
  vm.runInContext(`${source05}\nglobalThis.api = createHomeScreenMethods05();`, context);

  const screen = Object.assign(Object.create(context.api), {
    layoutMode: "modern",
    heroItem: { id: "col_1", type: "collection_folder", name: "Spanish" },
    heroCandidates: [],
    container: {
      querySelector: (sel) => (sel === ".home-hero-card" ? heroNode : null)
    },
    scheduleHomeTruncationUpdate() {},
    syncCollectionHeroMedia() {},
    applyHeroDescriptionAutoScroll() {}
  });

  screen.applyHeroToDom();
  assert.equal(observedAtSwap.length, 1);
  assert.equal(
    observedAtSwap[0].titleTextAtSwap,
    "🇪🇸  Spanish",
    "titleNode.textContent must be updated before animateHeroLogoSwap runs"
  );
  assert.equal(
    observedAtSwap[0].logoHiddenAtSwap,
    true,
    "freshly inserted logo must start hidden before preload finishes"
  );
  assert.equal(observedAtSwap[0].logoDisplayAtSwap, "none");

  // Folder with hideTitle: true (empty title) and no logo must stay empty & hidden, not "Untitled".
  currentDisplay = {
    ...currentDisplay,
    title: "",
    logo: ""
  };
  screen.applyHeroToDom();
  assert.equal(titleNode.textContent, "", "empty title must not fall back to Untitled");
  assert.equal(titleNode.classList.contains("is-hidden"), true);
});
