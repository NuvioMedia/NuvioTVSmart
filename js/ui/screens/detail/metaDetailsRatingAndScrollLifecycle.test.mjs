import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const stripModule = (source) =>
  source
    .replace(/^import [\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^import\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^export /gm, "");

const [focusSource, pointerSource, ratingsSource] = await Promise.all([
  readFile(
    new URL("./metaDetailsScreenMethods-17-capture-detail-focus.js", import.meta.url),
    "utf8"
  ),
  readFile(new URL("./metaDetailsScreenMethods-27-on-pointer-move.js", import.meta.url), "utf8"),
  readFile(new URL("./metaDetailsScreenMethods-28-ratings.js", import.meta.url), "utf8")
]);

test("MetaDetailsScreen closes rating dialog & cancels _sectionsUpdateRaf on cleanup, guards syncRatingButton, and stops detached scroll rAF", () => {
  let rafSeq = 0;
  const rafCallbacks = new Map();
  const cancelledRafs = [];
  let ratingCloseCount = 0;
  let dialogOpen = false;
  let renderCalls = 0;
  let focusCalls = 0;
  const bodyClasses = new Set();

  const ctx = vm.createContext({
    document: {
      body: {
        classList: {
          contains: (name) => bodyClasses.has(name)
        }
      },
      createElement: () => ({
        innerHTML: "",
        firstElementChild: {
          classList: {
            _names: new Set(),
            add(...names) {
              names.forEach((name) => this._names.add(name));
            },
            contains(name) {
              return this._names.has(name);
            }
          }
        }
      })
    },
    performance: { now: () => 0 },
    requestAnimationFrame: (cb) => {
      const id = ++rafSeq;
      rafCallbacks.set(id, cb);
      return id;
    },
    cancelAnimationFrame: (id) => {
      cancelledRafs.push(id);
      rafCallbacks.delete(id);
    },
    clearTimeout,
    setTimeout,
    WeakMap,
    Set,
    Math,
    Number,
    String,
    Boolean,
    internals: {
      ScreenUtils: { hide() {} },
      focusWithoutScroll: () => {},
      TrailerManager: { teardown() {} },
      TrackingRatings: {
        canRate: () => true,
        source: () => "trakt",
        get: () => ({ provider: "trakt", rating: 0 })
      },
      ratingMediaReference: () => ({ id: "tt1", type: "movie" }),
      resolveMetaImdbId: () => "tt1",
      resolveMetaTmdbId: () => null,
      ratingProviderName: () => "Trakt",
      openRatingDialog: () => {
        dialogOpen = true;
        bodyClasses.add("nuvio-modal-open");
        return {
          get isOpen() {
            return dialogOpen;
          },
          close() {
            dialogOpen = false;
            bodyClasses.delete("nuvio-modal-open");
            ratingCloseCount += 1;
          }
        };
      },
      t: (_k, _p, f) => f || "",
      escapeAttribute: (v) => String(v || ""),
      escapeHtml: (v) => String(v || ""),
      formatRating: (v) => String(v || ""),
      DETAIL_SCROLL_STIFFNESS: 200,
      DETAIL_SCROLL_DAMPING_RATIO: 1,
      DETAIL_SCROLL_MAX_FRAME_SECONDS: 0.05
    },
    ratingMediaReference: () => ({ id: "tt1", type: "movie" }),
    TrackingRatings: {
      canRate: () => true,
      source: () => "trakt",
      get: () => ({ provider: "trakt", rating: 0 }),
      current: () => ({ provider: "trakt", rating: 0 })
    },
    openRatingDialog: () => {
      dialogOpen = true;
      bodyClasses.add("nuvio-modal-open");
      return {
        get isOpen() {
          return dialogOpen;
        },
        close() {
          dialogOpen = false;
          bodyClasses.delete("nuvio-modal-open");
          ratingCloseCount += 1;
        }
      };
    },
    formatRating: (v) => String(v || ""),
    ratingProviderName: () => "Trakt",
    focusWithoutScroll: () => {
      focusCalls += 1;
    }
  });
  ctx.globalThis = ctx;
  vm.runInContext(
    `${stripModule(focusSource)}\n${stripModule(pointerSource)}\n${stripModule(ratingsSource)}\nglobalThis.api = { ...createMetaDetailsScreenMethods17(), ...createMetaDetailsScreenMethods27(), ...createMetaDetailsScreenMethods28() };`,
    ctx
  );

  const screen = Object.assign(Object.create(ctx.api), {
    detailLoadToken: 1,
    params: { fallbackTitle: "Test" },
    meta: { id: "tt1", type: "movie", name: "Test" },
    isTrailerPlaying: false,
    _sectionsUpdateRaf: 42,
    container: {
      querySelector: () => null,
      querySelectorAll: () => []
    },
    captureDetailFocus: () => ({}),
    render() {
      renderCalls += 1;
    },
    cancelTraktCommentsRequest() {},
    cancelPendingEpisodeHold() {},
    cancelPendingSeasonHold() {},
    cancelPendingPosterHold() {},
    cancelPendingHeroHold() {},
    destroyDetailHoldDialog() {},
    clearEpisodeTitleMarquee() {},
    stopTrailerPlayback() {},
    teardownEpisodeScrollHandlers() {},
    stopScrolledContainers() {},
    teardownTrailerFrame() {},
    isLegacyTvRuntime: () => false,
    isPerformanceConstrained: () => false
  });

  // 1. Trailer playback must not re-render the hero or pull focus out of the player.
  screen.isTrailerPlaying = true;
  screen.syncRatingButton();
  assert.equal(renderCalls, 0, "syncRatingButton must not re-render while a trailer is playing");

  const ratingNode = {
    classList: { contains: (name) => name === "focused" },
    replaceWith() {}
  };
  screen.container = {
    querySelector: (selector) => (selector === '[data-action="rateTitle"]' ? ratingNode : null),
    querySelectorAll: () => []
  };
  screen.syncRatingButton();
  assert.equal(
    focusCalls,
    0,
    "syncRatingButton must not focus the hero while a trailer is playing"
  );
  screen.isTrailerPlaying = false;
  screen.syncRatingButton();
  assert.equal(focusCalls, 1, "syncRatingButton keeps focus when no overlay is active");
  screen.container = { querySelector: () => null, querySelectorAll: () => [] };

  // 2. Opening rating dialog blocks syncRatingButton re-render while dialog is open.
  assert.equal(screen.openTitleRatingDialog(), true);
  screen.syncRatingButton();
  assert.equal(renderCalls, 0, "syncRatingButton must not re-render while rating dialog is open");

  // 3. cleanup() must close activeRatingDialog and cancel _sectionsUpdateRaf.
  screen.cleanup();
  assert.equal(ratingCloseCount, 1, "cleanup must close activeRatingDialog");
  assert.equal(cancelledRafs.includes(42), true, "cleanup must cancel _sectionsUpdateRaf");
  assert.equal(screen._sectionsUpdateRaf, null);

  // 4. Detached scroll container must stop tween scroll rAF instead of continuing forever.
  const detachedContainer = {
    isConnected: false,
    scrollTop: 0,
    scrollHeight: 2000,
    clientHeight: 400
  };
  screen.animateSpringScroll(detachedContainer, "y", 500);
  assert.equal(rafCallbacks.size, 1);
  const firstTick = Array.from(rafCallbacks.values())[0];
  rafCallbacks.clear();
  firstTick(50);
  assert.equal(
    rafCallbacks.size,
    0,
    "animateSpringScroll rAF must terminate when container.isConnected is false"
  );
});
