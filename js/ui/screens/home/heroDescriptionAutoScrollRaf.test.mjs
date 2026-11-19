import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const strip = (source) => source.replace(/^import [\s\S]*?;$/gm, "").replace(/^export /gm, "");

const source05 = strip(
  await readFile(new URL("./homeScreenMethods-05-apply-hero-to-dom.js", import.meta.url), "utf8")
);
const source14 = strip(
  await readFile(
    new URL("./homeScreenMethods-14-activate-focused-poster-flow.js", import.meta.url),
    "utf8"
  )
);
const source30 = strip(
  await readFile(new URL("./homeScreenMethods-30-cleanup.js", import.meta.url), "utf8")
);

function setupHome() {
  const applyCalls = [];
  let stopCalls = 0;
  let nextFrameId = 1;
  const scheduledFrames = new Map();
  const cancelledFrames = [];

  const context = vm.createContext({
    internals: {
      ScreenUtils: { hide: () => {} },
      Platform: { isTizen: () => false, isWebOS: () => false }
    },
    ensureHeroMdbListRatings: () => {},
    registerHomeDomNodes: () => {},
    resetHomeArtworkRescaler: () => {},
    resetHeroLogoRescaleCache: () => {},
    createHeroDescriptionAutoScroller: () => ({
      apply: (node, enabled) => applyCalls.push({ node, enabled }),
      stop: () => {
        stopCalls += 1;
      }
    }),
    requestAnimationFrame: (callback) => {
      const id = nextFrameId++;
      scheduledFrames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => {
      cancelledFrames.push(id);
      scheduledFrames.delete(id);
    },
    setTimeout,
    clearTimeout
  });

  vm.runInContext(
    `${source05}\n${source30}\nglobalThis.methods = { ...createHomeScreenMethods05(), ...createHomeScreenMethods30() };`,
    context
  );

  const descriptionNode = { isConnected: true };
  const container = {
    childNodes: [],
    classList: { add: () => {}, remove: () => {} },
    style: { removeProperty: () => {} },
    querySelector: (selector) =>
      selector === ".home-hero-card .home-hero-description" ? descriptionNode : null
  };
  const stub = () => {};
  const screen = Object.create(context.methods);
  Object.assign(screen, {
    container,
    layoutPrefs: { heroDescriptionAutoScrollEnabled: true },
    rows: [],
    hasLoadedOnce: false,
    cancelModernSidebarPillAutoCollapse: stub,
    cancelPendingContinueWatchingEnter: stub,
    cancelPendingContinueWatchingHold: stub,
    destroyHomeHoldDialog: stub,
    unlockHomeHoldFocus: stub,
    persistCurrentFocusState: stub,
    cancelInitialHomeLoadTimeout: stub,
    cancelScheduledRender: stub,
    cancelModernCameraFollow: stub,
    endModernVerticalFastScroll: stub,
    stopHeroRotation: stub,
    cancelPendingHeroFocus: stub,
    cancelFocusedPosterFlow: stub,
    clearFocusedPosterFlowState: stub,
    collapseFocusedPoster: stub,
    clearHomeTrailerLayers: stub,
    teardownGridStickyHeader: stub,
    teardownModernTrackScrollPagination: stub,
    teardownContinueWatchingProgressiveRendering: stub,
    releaseAllHomeLazyImages: stub
  });

  const flushFrames = () => {
    const callbacks = Array.from(scheduledFrames.values());
    scheduledFrames.clear();
    callbacks.forEach((callback) => callback());
  };

  return {
    screen,
    descriptionNode,
    applyCalls,
    scheduledFrames,
    cancelledFrames,
    flushFrames,
    getStopCalls: () => stopCalls
  };
}

test("applyHeroDescriptionAutoScroll defers the layout read and coalesces rapid calls", () => {
  const {
    screen,
    descriptionNode,
    applyCalls,
    scheduledFrames,
    cancelledFrames,
    flushFrames,
    getStopCalls
  } = setupHome();

  screen.applyHeroDescriptionAutoScroll();
  assert.equal(applyCalls.length, 0, "scroller.apply must not run synchronously");
  assert.equal(scheduledFrames.size, 1);

  screen.applyHeroDescriptionAutoScroll();
  assert.equal(cancelledFrames.length, 1, "previous pending frame is cancelled");
  assert.equal(scheduledFrames.size, 1);
  // The running scroller stays untouched until the frame: stopping it here
  // would recreate the description text node the hero update just registered.
  assert.equal(getStopCalls(), 0);

  flushFrames();
  assert.equal(applyCalls.length, 1);
  assert.equal(applyCalls[0].node, descriptionNode);
  assert.equal(applyCalls[0].enabled, true);
});

test("disabled auto-scroll stops synchronously instead of scheduling a frame", () => {
  const { screen, scheduledFrames, cancelledFrames, getStopCalls } = setupHome();

  screen.applyHeroDescriptionAutoScroll();
  assert.equal(scheduledFrames.size, 1);

  screen.layoutPrefs.heroDescriptionAutoScrollEnabled = false;
  screen.applyHeroDescriptionAutoScroll();

  assert.equal(cancelledFrames.length, 1);
  assert.equal(scheduledFrames.size, 0);
  assert.equal(getStopCalls(), 1);
});

test("a detached description never reaches the deferred apply", () => {
  const { screen, descriptionNode, applyCalls, flushFrames } = setupHome();

  screen.applyHeroDescriptionAutoScroll();
  descriptionNode.isConnected = false;
  flushFrames();

  assert.equal(applyCalls.length, 0);
});

test("cleanup cancels the pending hero description frame", () => {
  const { screen, applyCalls, scheduledFrames, cancelledFrames, flushFrames } = setupHome();

  screen.applyHeroDescriptionAutoScroll();
  assert.equal(scheduledFrames.size, 1);

  screen.cleanup();
  assert.equal(cancelledFrames.length, 1);
  assert.equal(scheduledFrames.size, 0);
  assert.equal(screen.heroDescriptionAutoScrollFrame, 0);

  flushFrames();
  assert.equal(applyCalls.length, 0);
});

function setupTruncation() {
  class HTMLElement {}
  const context = vm.createContext({
    HTMLElement,
    internals: {},
    registerHomeDomNodes: () => {},
    getTrailerMountGraceMs: () => 0,
    setTimeout,
    clearTimeout
  });
  vm.runInContext(`${source14}\nglobalThis.methods = createHomeScreenMethods14();`, context);
  const description = new HTMLElement();
  description.textContent = "Full synopsis";
  description.classList = { contains: () => false, add: () => {}, remove: () => {} };
  description.dataset = {};
  description.clientWidth = 100;
  description.clientHeight = 40;
  description.scrollWidth = 100;
  description.scrollHeight = 120;
  const screen = Object.create(context.methods);
  Object.assign(screen, {
    container: { querySelectorAll: () => [description] },
    layoutMode: "classic",
    homeTruncationScope: null,
    applyModernHeroDescriptionBounds: () => {}
  });
  return { screen, description };
}

test("the measured truncation pass leaves the description alone while its frame is pending", () => {
  const { screen, description } = setupTruncation();

  screen.heroDescriptionAutoScrollFrame = 1;
  screen.applyHomeTruncationState();

  assert.equal(description.textContent, "Full synopsis");
  assert.equal(description.dataset.fullText, undefined);
});

test("without a pending frame the measured truncation pass still shortens the description", () => {
  const { screen, description } = setupTruncation();

  screen.heroDescriptionAutoScrollFrame = 0;
  screen.applyHomeTruncationState();

  assert.ok(description.textContent.endsWith("..."));
});
