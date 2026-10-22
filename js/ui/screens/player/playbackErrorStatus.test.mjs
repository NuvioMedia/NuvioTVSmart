import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPlaybackHttpStatus } from "./playerScreenHelpers-08-track-list-to-array.js";

// Exact strings captured from the LG k8lp during a failed cricket stream.
const HLS_404 = "A network error (status 404) occurred while loading manifest";
const HLS_403 = "HTTP Error 403 Forbidden";

// Mirror of the shipped resolvePlaybackHttpStatus
function resolve(detail, hlsDetail) {
  return extractPlaybackHttpStatus(detail) || extractPlaybackHttpStatus(hlsDetail);
}

test("hls.js manifest 404 is recognised as a status", () => {
  assert.equal(extractPlaybackHttpStatus(HLS_404), 404);
});

test("hls.js fragment 403 is recognised as a status", () => {
  assert.equal(extractPlaybackHttpStatus(HLS_403), 403);
});

test("status is lost when only the media detail is read (the bug)", () => {
  assert.equal(extractPlaybackHttpStatus(""), 0);
});

test("status is recovered from the hls.js error (the fix)", () => {
  assert.equal(resolve("", HLS_404), 404);
  assert.equal(resolve("", HLS_403), 403);
});

test("an explicit detail still wins over the hls.js error", () => {
  assert.equal(resolve("HTTP 500 upstream", HLS_404), 500);
});

test("a failure with no status anywhere still yields none", () => {
  assert.equal(resolve("", "bufferSeekOverHole"), 0);
});
