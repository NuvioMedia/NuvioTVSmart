import { resolveSubtitleStyleControlAvailability } from "../js/core/player/subtitlePresentationCapabilities.js";
import assert from "node:assert/strict";
import { applyAssSubtitlePlacement as apply } from "../js/core/player/assSubtitlePlacement.js";
import { assSubtitleRuntimeSource } from "./assSubtitleRuntime.mjs";
const cue = (y = 350) => ({
  align: { v: 0 },
  y,
  height: 20,
  slices: [{ style: "Default", fragments: [{ text: "Text" }] }],
  $div: { style: { top: `${y}px` } }
});
const store = {
  height: 360,
  box: { getBoundingClientRect: () => ({ top: 10, bottom: 730, height: 720 }) },
  actives: [],
  playerSubtitlePlacement: { viewportBottom: 730, overlayTop: 490, userOffsetPx: 0 }
};
const low = cue(350),
  high = cue(320);
store.actives = [low, high];
assert(apply(low, store));
assert(apply(high, store));
assert.equal(parseFloat(low.$div.style.top), 240);
assert.equal(parseFloat(low.$div.style.top) - parseFloat(high.$div.style.top), 30);
for (const flag of ["pos", "move", "org", "clip", "effect"]) {
  const sign = cue();
  sign[flag] = {};
  assert.equal(apply(sign, store), false);
  assert.equal(sign.$div.style.top, "350px");
}
for (const value of [1, 2]) {
  const positioned = cue();
  positioned.align.v = value;
  assert.equal(apply(positioned, store), false);
}
for (const fragment of [{ drawing: {} }, { keyframes: [{}] }, { tag: { frz: 45 } }]) {
  const sign = cue();
  sign.slices[0].fragments = [fragment];
  assert.equal(apply(sign, store), false);
}
store.playerSubtitlePlacement.overlayTop = null;
apply(low, store);
apply(high, store);
assert.equal(low.$div.style.top, "350px");
assert.equal(high.$div.style.top, "320px");
store.playerSubtitlePlacement.userOffsetPx = 40;
apply(low, store);
assert.equal(low.$div.style.top, "330px");
const runtime = await assSubtitleRuntimeSource(process.cwd());
assert(runtime.includes("setSubtitlePlacement(placement)"));
assert(runtime.includes("globalThis.ASS = ASS;"));
console.log(
  "ASS placement fixtures passed: scaled coordinates, stacking, authored positions/animation/drawings, restoration and pinned runtime hooks."
);

const supported = resolveSubtitleStyleControlAvailability({
  preserveAssStyles: true,
  supportsAssPlacement: true,
  rendererMode: "html"
});
assert.equal(supported.verticalOffset, true);
assert.equal(supported.fontSize, false);
assert.equal(supported.outlineSize, false);
assert.equal(
  resolveSubtitleStyleControlAvailability({ preserveAssStyles: true }).verticalOffset,
  false
);
assert.equal(
  resolveSubtitleStyleControlAvailability({ isTizenAvPlay: true, rendererMode: "embedded-native" })
    .verticalOffset,
  false
);
