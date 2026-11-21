import assert from "node:assert/strict";
import test from "node:test";
import { syncHtmlSubtitleClearance } from "./subtitleOverlayClearance.js";

function makeHiddenNode() {
  const classes = new Set(["hidden"]);
  return {
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name)
    },
    getClientRects: () => [1],
    getBoundingClientRect: () => ({ top: 400, height: 40 })
  };
}

test("syncHtmlSubtitleClearance skips layout reads when overlays are hidden and caches ASS no-overlay state", () => {
  const props = new Map();
  let rootRectCalls = 0;
  let styleWrites = 0;
  const placements = [];
  const previousGetComputedStyle = globalThis.getComputedStyle;
  const previousInnerHeight = globalThis.innerHeight;
  globalThis.getComputedStyle = () => ({ display: "block", visibility: "visible" });
  globalThis.innerHeight = 1080;

  try {
    const controlsBottom = makeHiddenNode();
    const skipIntro = makeHiddenNode();
    const nextEpisodeCard = makeHiddenNode();
    const seekOverlay = makeHiddenNode();

    const screenNoAss = {
      controlsVisible: false,
      controlsHideUntil: 0,
      seekOverlayVisible: false,
      subtitleDialogVisible: false,
      uiRefs: {
        root: {
          style: {
            getPropertyValue: (k) => props.get(k) || "",
            setProperty: (k, v) => {
              styleWrites += 1;
              props.set(k, v);
            }
          },
          getBoundingClientRect: () => {
            rootRectCalls += 1;
            return { bottom: 1080, height: 1080 };
          }
        },
        controlsBottom,
        controlsOverlay: makeHiddenNode(),
        skipIntro,
        nextEpisodeCard,
        seekOverlay
      }
    };

    syncHtmlSubtitleClearance(screenNoAss);
    syncHtmlSubtitleClearance(screenNoAss);
    syncHtmlSubtitleClearance(screenNoAss);
    assert.equal(rootRectCalls, 0, "hidden overlays without ASS must avoid getBoundingClientRect");
    assert.equal(props.get("--player-subtitle-clearance"), "0px");
    assert.equal(styleWrites, 1, "--player-subtitle-clearance must not be rewritten once 0px");

    screenNoAss.subtitleStyleSettings = { verticalOffset: 5 };
    screenNoAss.assSubtitleRenderer = {
      setPlacement: (payload) => placements.push(payload)
    };
    syncHtmlSubtitleClearance(screenNoAss);
    syncHtmlSubtitleClearance(screenNoAss);
    syncHtmlSubtitleClearance(screenNoAss);
    assert.equal(rootRectCalls, 1);
    assert.equal(placements.length, 1);
    assert.equal(placements[0].overlayTop, null);

    screenNoAss.subtitleStyleSettings.verticalOffset = 10;
    syncHtmlSubtitleClearance(screenNoAss);
    syncHtmlSubtitleClearance(screenNoAss);
    assert.equal(rootRectCalls, 2);
    assert.equal(placements.length, 2);

    screenNoAss.controlsVisible = true;
    controlsBottom.classList.remove("hidden");
    syncHtmlSubtitleClearance(screenNoAss);
    assert.equal(rootRectCalls, 3);
    assert.notEqual(placements[2].overlayTop, null);

    screenNoAss.controlsVisible = false;
    controlsBottom.classList.add("hidden");
    syncHtmlSubtitleClearance(screenNoAss);
    syncHtmlSubtitleClearance(screenNoAss);
    assert.equal(rootRectCalls, 4);
    assert.equal(placements.length, 4);
    assert.equal(placements[3].overlayTop, null);
  } finally {
    globalThis.getComputedStyle = previousGetComputedStyle;
    if (previousInnerHeight === undefined) {
      delete globalThis.innerHeight;
    } else {
      globalThis.innerHeight = previousInnerHeight;
    }
  }
});

test("syncHtmlSubtitleClearance preserves subtitleDialogVisible parity from oct16 UI parity suite", () => {
  const properties = new Map();
  let placement = null;
  const previousGetComputedStyle = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => ({ display: "block", visibility: "visible" });
  const classes = () => ({ contains: () => false, add() {}, remove() {} });
  const node = (top) => ({
    classList: classes(),
    getClientRects: () => [1],
    getBoundingClientRect: () => ({ top, height: 40 })
  });

  try {
    const player = {
      controlsVisible: true,
      seekOverlayVisible: true,
      subtitleDialogVisible: false,
      subtitleStyleSettings: { verticalOffset: 15 },
      assSubtitleRenderer: {
        setPlacement: (p) => {
          placement = p;
        }
      },
      uiRefs: {
        root: {
          style: {
            getPropertyValue: (k) => properties.get(k),
            setProperty: (k, v) => properties.set(k, v)
          },
          getBoundingClientRect: () => ({ bottom: 540, height: 540 })
        },
        controlsBottom: node(350),
        controlsOverlay: { classList: classes() },
        skipIntro: node(290),
        nextEpisodeCard: node(250),
        seekOverlay: node(280)
      }
    };

    syncHtmlSubtitleClearance(player);
    const lift = properties.get("--player-subtitle-clearance");
    const offset = placement.userOffsetPx;
    assert.notEqual(lift, "0px");

    player.subtitleDialogVisible = true;
    syncHtmlSubtitleClearance(player);
    assert.equal(properties.get("--player-subtitle-clearance"), "0px");
    assert.equal(placement.overlayTop, null);
    assert.equal(placement.userOffsetPx, offset);

    player.subtitleDialogVisible = false;
    syncHtmlSubtitleClearance(player);
    assert.equal(properties.get("--player-subtitle-clearance"), lift);
  } finally {
    globalThis.getComputedStyle = previousGetComputedStyle;
  }
});
