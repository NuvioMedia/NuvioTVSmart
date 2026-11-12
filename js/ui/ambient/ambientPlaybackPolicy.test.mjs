import assert from "node:assert/strict";
import test from "node:test";
import { isAmbientTrailerPlaying } from "./ambientPlaybackPolicy.js";

const screenWith = (...nodes) => ({ container: { querySelectorAll: () => nodes } });
const video = (dataset = {}) => ({
  isConnected: true,
  tagName: "VIDEO",
  paused: false,
  ended: false,
  readyState: 4,
  dataset
});
const frame = (dataset) => ({ isConnected: true, tagName: "IFRAME", dataset });

test("a trailer on its first pass keeps Ambient Mode away", () => {
  assert.equal(isAmbientTrailerPlaying(screenWith(video())), true);
  assert.equal(isAmbientTrailerPlaying(screenWith(frame({ ambientTrailerPlaying: "true" }))), true);
});

test("a trailer that has looped no longer counts as playing", () => {
  assert.equal(isAmbientTrailerPlaying(screenWith(video({ ambientTrailerLooped: "true" }))), false);
  assert.equal(
    isAmbientTrailerPlaying(
      screenWith(frame({ ambientTrailerPlaying: "false", ambientTrailerLooped: "true" }))
    ),
    false
  );
});
