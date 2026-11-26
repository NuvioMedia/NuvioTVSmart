import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const stripModule = (source) =>
  source
    .replace(/^import [\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^import\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^export \* from\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^export \{[\s\S]*?\};\r?\n/gm, "")
    .replace(/^export /gm, "");

const [folderScreenSource, folderMethods05Source, homeMethods07Source] = await Promise.all(
  [
    "./folderDetailScreen.js",
    "./folderDetailScreenMethods-05-on-key-down.js",
    "../home/homeScreenMethods-07-mount-continue-watching-dialog.js"
  ].map(async (relPath) => stripModule(await readFile(new URL(relPath, import.meta.url), "utf8")))
);

function loadFactory(source, factoryName, internals, globals = {}) {
  const sandbox = {
    internals,
    console,
    Date,
    Number,
    String,
    Boolean,
    Object,
    Array,
    Math,
    Set,
    Map,
    WeakMap,
    Promise,
    setTimeout,
    clearTimeout,
    ...globals
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${source}\nglobalThis.__factory = ${factoryName};`, sandbox);
  return sandbox.__factory;
}

test("FolderDetailScreen owns its per-screen trailer, scroll, hold-dialog, and listener state without polluting HomeScreen", () => {
  const homeFocusHandler = () => "home-focus";
  const homeScrollHandler = () => "home-scroll";
  const HomeScreen = {
    mountedHomeTrailerLayers: new Set(["home-layer"]),
    _trackScrollHandlers: new Map([["home-track", () => {}]]),
    activeScrollAnimationContainers: new Set(["home-scroller"]),
    homeTrailerLayerCleanupTimers: new WeakMap(),
    homeTrailerLayerHideTimers: new WeakMap(),
    homeTrailerFrameCleanup: new WeakMap(),
    boundHomeFocusInHandler: homeFocusHandler,
    boundHomeClickHandler: () => "home-click",
    boundHomeMouseDownHandler: () => "home-down",
    boundHomeMouseOverHandler: () => "home-over",
    boundHomeWheelHandler: () => "home-wheel",
    boundHomeEventContainer: { id: "home" },
    boundHomeViewportScrollHandler: homeScrollHandler,
    boundHomeViewport: { id: "home-viewport" },
    homeRowWindow: { id: "home-window" },
    homeRowWindowRoot: { id: "home-window-root" },
    _homeHoldDialog: { id: "home-dialog" },
    continueWatchingMenu: { id: "home-cw" },
    posterHoldMenu: { id: "home-poster" },
    posterListPicker: { id: "home-picker" },
    suppressHoldMenuEnterUntilKeyUp: true,
    sidebarExpanded: true
  };

  const sandbox = {
    HomeScreen,
    Object,
    Set,
    Map,
    WeakMap,
    createFolderDetailScreenMethods01: () => ({}),
    createFolderDetailScreenMethods02: () => ({}),
    createFolderDetailScreenMethods03: () => ({}),
    createFolderDetailScreenMethods04: () => ({}),
    createFolderDetailScreenMethods05: () => ({})
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    `${folderScreenSource}\nglobalThis.FolderDetailScreen = FolderDetailScreen;`,
    sandbox
  );

  const FolderDetailScreen = sandbox.FolderDetailScreen;
  assert.equal(Object.getPrototypeOf(FolderDetailScreen), HomeScreen);

  for (const prop of [
    "mountedHomeTrailerLayers",
    "_trackScrollHandlers",
    "activeScrollAnimationContainers",
    "boundHomeFocusInHandler",
    "boundHomeClickHandler",
    "boundHomeMouseDownHandler",
    "boundHomeMouseOverHandler",
    "boundHomeWheelHandler",
    "boundHomeEventContainer",
    "boundHomeViewportScrollHandler",
    "boundHomeViewport",
    "homeRowWindow",
    "_homeHoldDialog",
    "continueWatchingMenu",
    "posterHoldMenu",
    "posterListPicker",
    "suppressHoldMenuEnterUntilKeyUp",
    "sidebarExpanded"
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(FolderDetailScreen, prop),
      true,
      `FolderDetailScreen must define own property "${prop}" so prototype delegation never mutates HomeScreen`
    );
  }

  FolderDetailScreen.mountedHomeTrailerLayers.add("folder-layer");
  FolderDetailScreen._trackScrollHandlers.set("folder-track", () => {});
  FolderDetailScreen.activeScrollAnimationContainers.add("folder-scroller");

  assert.equal(HomeScreen.mountedHomeTrailerLayers.has("folder-layer"), false);
  assert.equal(HomeScreen._trackScrollHandlers.has("folder-track"), false);
  assert.equal(HomeScreen.activeScrollAnimationContainers.has("folder-scroller"), false);
  assert.equal(FolderDetailScreen.boundHomeFocusInHandler, null);
  assert.equal(FolderDetailScreen.boundHomeViewportScrollHandler, null);
  assert.equal(FolderDetailScreen._homeHoldDialog, null);
  assert.equal(FolderDetailScreen.sidebarExpanded, false);
});

test("FolderDetailScreen.consumeBackRequest dismisses _homeHoldDialog and posterListPicker cleanly", () => {
  const calls = [];
  const HomeScreen = {
    pendingCollectionRouteReturnAnimation: false,
    dismissContinueWatchingMenu() {
      calls.push("dismissContinueWatchingMenu");
      this._homeHoldDialog = null;
      this.continueWatchingMenu = null;
    },
    dismissPosterHoldMenu() {
      calls.push("dismissPosterHoldMenu");
      this._homeHoldDialog = null;
      this.posterHoldMenu = null;
    },
    closeContinueWatchingMenu() {
      calls.push("closeContinueWatchingMenu");
      this.continueWatchingMenu = null;
    },
    closePosterHoldMenu() {
      calls.push("closePosterHoldMenu");
      this.posterHoldMenu = null;
    },
    unlockHomeHoldFocus() {
      calls.push("unlockHomeHoldFocus");
      this.homeHoldFocusLocked = false;
    }
  };
  const api = loadFactory(folderMethods05Source, "createFolderDetailScreenMethods05", {
    Router: { back: () => calls.push("Router.back") },
    ScreenUtils: { hide: () => {} },
    HomeScreen,
    isBackEvent: () => false
  })();

  const screen = Object.assign(Object.create(api), {
    useHomeFollowLayout: true,
    suppressHoldMenuEnterUntilKeyUp: true,
    _homeHoldDialog: { destroy: () => calls.push("dialog.destroy") },
    posterListPicker: { item: { id: "tt1" } },
    posterHoldMenu: null,
    continueWatchingMenu: null
  });

  // 1. Poster list picker dialog open -> must destroy dialog, clear picker, dismiss, and return true.
  assert.equal(screen.consumeBackRequest(), true);
  assert.deepEqual(calls, ["dialog.destroy", "dismissPosterHoldMenu"]);
  assert.equal(screen.posterListPicker, null);
  assert.equal(screen.suppressHoldMenuEnterUntilKeyUp, false);

  // 2. Orphaned _homeHoldDialog with neither menu nor picker -> must destroy and unlock focus.
  calls.length = 0;
  screen._homeHoldDialog = { destroy: () => calls.push("dialog.destroy") };
  screen.suppressHoldMenuEnterUntilKeyUp = true;
  assert.equal(screen.consumeBackRequest(), true);
  assert.deepEqual(calls, ["dialog.destroy", "unlockHomeHoldFocus"]);
  assert.equal(screen._homeHoldDialog, null);
  assert.equal(screen.suppressHoldMenuEnterUntilKeyUp, false);

  // 3. Idle -> prepares Home return animation and returns false so Router.back() navigates.
  calls.length = 0;
  HomeScreen.pendingCollectionRouteReturnAnimation = false;
  assert.equal(screen.consumeBackRequest(), false);
  assert.equal(HomeScreen.pendingCollectionRouteReturnAnimation, true);
});

test("FolderDetailScreen.cleanup tears down trailers, hold dialogs, scroll animations, rowWindow, and capture/container listeners", () => {
  const calls = [];
  const cancelledRafs = [];
  const clearedTimeouts = [];
  const removedViewportListeners = [];
  const removedContainerListeners = [];

  const HomeScreen = {
    cancelPendingContinueWatchingEnter() {
      calls.push("cancelPendingContinueWatchingEnter");
    },
    cancelPendingContinueWatchingHold() {
      calls.push("cancelPendingContinueWatchingHold");
    },
    destroyHomeHoldDialog() {
      calls.push("destroyHomeHoldDialog");
      this._homeHoldDialog = null;
    },
    unlockHomeHoldFocus() {
      calls.push("unlockHomeHoldFocus");
    },
    cancelModernCameraFollow(opts) {
      calls.push(["cancelModernCameraFollow", opts]);
    },
    cancelAllScrollAnimations() {
      calls.push("cancelAllScrollAnimations");
    },
    endModernVerticalFastScroll(opts) {
      calls.push(["endModernVerticalFastScroll", opts]);
    },
    stopHeroRotation() {
      calls.push("stopHeroRotation");
    },
    cancelPendingHeroFocus() {
      calls.push("cancelPendingHeroFocus");
    },
    cancelFocusedPosterFlow() {
      calls.push("cancelFocusedPosterFlow");
    },
    clearFocusedPosterFlowState() {
      calls.push("clearFocusedPosterFlowState");
    },
    collapseFocusedPoster() {
      calls.push("collapseFocusedPoster");
    },
    clearHomeTrailerLayers() {
      calls.push("clearHomeTrailerLayers");
    },
    teardownModernTrackScrollPagination() {
      calls.push("teardownModernTrackScrollPagination");
    }
  };
  const api = loadFactory(
    folderMethods05Source,
    "createFolderDetailScreenMethods05",
    {
      Router: { back: () => {} },
      ScreenUtils: { hide: () => calls.push("ScreenUtils.hide") },
      HomeScreen,
      isBackEvent: () => false
    },
    {
      cancelAnimationFrame: (id) => cancelledRafs.push(id),
      clearTimeout: (id) => clearedTimeouts.push(id)
    }
  )();

  const focusHandler = () => {};
  const clickHandler = () => {};
  const downHandler = () => {};
  const overHandler = () => {};
  const wheelHandler = () => {};
  const scrollHandler = () => {};

  const screen = Object.assign(Object.create(api), {
    useHomeFollowLayout: true,
    container: { id: "folderDetail" },
    folderLoadToken: 3,
    _trackPaginationInFlight: new Set(["row1"]),
    cancelScheduledRender: () => calls.push("cancelScheduledRender"),
    homeRowWindow: { destroy: () => calls.push("homeRowWindow.destroy") },
    homeRowWindowRoot: { id: "root" },
    _homeHoldDialog: { id: "dialog" },
    continueWatchingMenu: { id: "cw" },
    posterHoldMenu: { id: "poster" },
    posterListPicker: { id: "picker" },
    suppressHoldMenuEnterUntilKeyUp: true,
    sidebarExpanded: true,
    _mainVertRaf: 11,
    _mainClassicVertRaf: 12,
    _trackHorizRaf: 13,
    homeViewportScrollFrame: 14,
    homeViewportFocusSyncTimer: 99,
    boundHomeViewport: {
      removeEventListener: (type, handler, capture) => {
        removedViewportListeners.push({ type, handler, capture });
      }
    },
    boundHomeViewportScrollHandler: scrollHandler,
    boundHomeEventContainer: {
      removeEventListener: (type, handler) => {
        removedContainerListeners.push({ type, handler });
      }
    },
    boundHomeFocusInHandler: focusHandler,
    boundHomeClickHandler: clickHandler,
    boundHomeMouseDownHandler: downHandler,
    boundHomeMouseOverHandler: overHandler,
    boundHomeWheelHandler: wheelHandler
  });

  screen.cleanup();

  assert.equal(screen.folderLoadToken, 4);
  assert.equal(screen._trackPaginationInFlight.size, 0);
  assert.equal(screen.homeRowWindow, null);
  assert.equal(screen.homeRowWindowRoot, null);
  assert.equal(screen._homeHoldDialog, null);
  assert.equal(screen.continueWatchingMenu, null);
  assert.equal(screen.posterHoldMenu, null);
  assert.equal(screen.posterListPicker, null);
  assert.equal(screen.suppressHoldMenuEnterUntilKeyUp, false);
  assert.equal(screen.sidebarExpanded, false);
  assert.equal(screen.boundHomeViewport, null);
  assert.equal(screen.boundHomeEventContainer, null);

  assert.ok(calls.includes("homeRowWindow.destroy"), "cleanup must destroy homeRowWindow");
  assert.ok(calls.includes("clearHomeTrailerLayers"), "cleanup must clear trailer layers");
  assert.ok(calls.includes("destroyHomeHoldDialog"), "cleanup must destroy active hold dialog");
  assert.ok(calls.includes("unlockHomeHoldFocus"), "cleanup must unlock hold focus");
  assert.ok(
    calls.includes("cancelPendingContinueWatchingHold"),
    "cleanup must cancel pending hold"
  );
  assert.ok(calls.includes("cancelAllScrollAnimations"), "cleanup must stop scroll animations");
  assert.ok(
    calls.some((entry) => Array.isArray(entry) && entry[0] === "endModernVerticalFastScroll"),
    "cleanup must stop fast vertical scroll"
  );
  assert.deepEqual(
    cancelledRafs.sort((a, b) => a - b),
    [11, 12, 13, 14]
  );
  assert.deepEqual(clearedTimeouts, [99]);
  assert.deepEqual(
    removedViewportListeners,
    [{ type: "scroll", handler: scrollHandler, capture: true }],
    "viewport scroll listener must be removed with capture=true matching addEventListener"
  );
  assert.deepEqual(
    removedContainerListeners.map((entry) => entry.type),
    ["focusin", "click", "mousedown", "mouseover", "wheel"],
    "all 5 delegated listeners must be detached from boundHomeEventContainer"
  );
});

test("HomeScreen hold dialogs clear suppressHoldMenuEnterUntilKeyUp on dismiss, action, and close", () => {
  const dialogs = [];
  class MockNuvioDialog {
    constructor(config) {
      this.config = config;
      dialogs.push(this);
    }
    mount() {
      return this;
    }
    destroy() {}
  }

  const api = loadFactory(
    homeMethods07Source,
    "createHomeScreenMethods07",
    {
      Router: { getCurrentScreen: () => null },
      watchedItemsRepository: {},
      savedLibraryRepository: {},
      libraryRepository: {},
      LibrarySourceMode: { LOCAL: "local", SIMKL: "simkl" },
      supportsMembershipFor: () => true,
      isTitleItemWatched: () => false,
      NuvioDialog: MockNuvioDialog,
      t: (_k, _p, fallback) => fallback || "",
      normalizeCatalogItem: (item) => item
    },
    {
      getPosterListPickerOptions: () => [],
      trackingErrorMessage: () => "",
      document: { body: {} }
    }
  )();

  const screen = Object.assign(Object.create(api), {
    suppressHoldMenuEnterUntilKeyUp: false,
    lockHomeHoldFocus() {},
    destroyHomeHoldDialog() {
      this._homeHoldDialog = null;
    },
    scheduleHoldMenuScrollRestore() {},
    getPosterHoldMenuItem: () => ({ id: "tt1", name: "Movie" }),
    getPosterHoldMenuOptions: () => [{ label: "Open", action: "open" }],
    getContinueWatchingMenuItem: () => ({ contentId: "tt2", title: "Show" }),
    getContinueWatchingMenuOptions: () => [{ label: "Resume", action: "resume" }],
    activatePosterHoldMenuOption() {},
    activateContinueWatchingMenuOption() {},
    dismissPosterHoldMenu() {
      this._homeHoldDialog = null;
      this.posterHoldMenu = null;
    },
    dismissContinueWatchingMenu() {
      this._homeHoldDialog = null;
      this.continueWatchingMenu = null;
    },
    restorePosterHoldMenuFocus() {},
    restoreContinueWatchingMenuFocus() {}
  });

  // Poster hold dialog: onDismiss must clear suppressHoldMenuEnterUntilKeyUp.
  screen.posterHoldMenu = { item: { id: "tt1" } };
  screen.mountPosterHoldDialog();
  assert.equal(screen.suppressHoldMenuEnterUntilKeyUp, true);
  dialogs.at(-1).config.onDismiss();
  assert.equal(
    screen.suppressHoldMenuEnterUntilKeyUp,
    false,
    "dismissing poster hold dialog must clear suppressHoldMenuEnterUntilKeyUp"
  );

  // Poster hold dialog: button onAction must clear suppressHoldMenuEnterUntilKeyUp.
  screen.posterHoldMenu = { item: { id: "tt1" } };
  screen.mountPosterHoldDialog();
  assert.equal(screen.suppressHoldMenuEnterUntilKeyUp, true);
  dialogs.at(-1).config.buttons[0].onAction();
  assert.equal(screen.suppressHoldMenuEnterUntilKeyUp, false);

  // Continue watching hold dialog: onDismiss and closeContinueWatchingMenu must clear it too.
  screen.continueWatchingMenu = { contentId: "tt2" };
  screen.mountContinueWatchingDialog();
  assert.equal(screen.suppressHoldMenuEnterUntilKeyUp, true);
  dialogs.at(-1).config.onDismiss();
  assert.equal(screen.suppressHoldMenuEnterUntilKeyUp, false);

  screen.continueWatchingMenu = { contentId: "tt2" };
  screen.mountContinueWatchingDialog();
  assert.equal(screen.suppressHoldMenuEnterUntilKeyUp, true);
  screen.closeContinueWatchingMenu();
  assert.equal(screen.suppressHoldMenuEnterUntilKeyUp, false);
});
