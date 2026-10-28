import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeSourceRect,
  getHomeArtworkPixelRatio,
  isJpegHeader,
  isRescalableArtworkFit
} from "./tvPosterRescaler.js";

// Every existing crop case is a cover crop; fill has its own cases below.
const computeCoverRect = (nw, nh, bw, bh) => computeSourceRect(nw, nh, bw, bh, "cover");

function withScreen({ innerWidth, screenWidth, devicePixelRatio }) {
  const previous = {
    innerWidth: globalThis.innerWidth,
    screen: globalThis.screen,
    devicePixelRatio: globalThis.devicePixelRatio
  };
  Object.assign(globalThis, { innerWidth, screen: { width: screenWidth }, devicePixelRatio });
  try {
    return getHomeArtworkPixelRatio();
  } finally {
    Object.assign(globalThis, previous);
  }
}

test("a wide addon thumbnail is cropped on its sides for a poster slot", () => {
  // The sports addons hand back 800x450 artwork for a 220x338 card, which is
  // the case that dominates decoded memory on the home screen.
  const rect = computeCoverRect(800, 450, 220, 338);
  assert.equal(rect.sy, 0);
  assert.equal(rect.sh, 450);
  assert.equal(rect.sw, 293);
  assert.equal(rect.sx, 254);
  assert.ok(rect.sx + rect.sw <= 800);
});

test("a tall source is cropped top and bottom instead", () => {
  const rect = computeCoverRect(300, 900, 220, 338);
  assert.equal(rect.sx, 0);
  assert.equal(rect.sw, 300);
  assert.equal(rect.sh, 461);
  assert.ok(rect.sy + rect.sh <= 900);
});

test("the crop keeps the box aspect ratio so nothing is stretched", () => {
  const boxAspect = 220 / 338;
  [
    [800, 450],
    [1024, 576],
    [1280, 720],
    [500, 750],
    [342, 513]
  ].forEach(([nw, nh]) => {
    const rect = computeCoverRect(nw, nh, 220, 338);
    assert.ok(Math.abs(rect.sw / rect.sh - boxAspect) < 0.01, `${nw}x${nh} kept its aspect`);
  });
});

test("a source already matching the box is taken whole", () => {
  const rect = computeCoverRect(220, 338, 220, 338);
  assert.deepEqual(rect, { sx: 0, sy: 0, sw: 220, sh: 338 });
});

test("a landscape backdrop slot crops a landscape source only slightly", () => {
  const rect = computeCoverRect(1280, 720, 428, 243);
  assert.equal(rect.sh, 720);
  assert.ok(rect.sw > 1200 && rect.sw <= 1280);
});

test("the crop never collapses to zero on extreme sources", () => {
  const rect = computeCoverRect(2000, 10, 220, 338);
  assert.ok(rect.sw >= 1);
  assert.ok(rect.sh >= 1);
});

test("a 1080p webOS panel is treated as one device pixel per css pixel", () => {
  // webOS reports 2 here even though the viewport is already the panel width.
  const ratio = withScreen({ innerWidth: 1920, screenWidth: 1920, devicePixelRatio: 2 });
  assert.equal(ratio, 1);
});

test("a 4K panel laid out at 1920 still decodes at two device pixels", () => {
  const ratio = withScreen({ innerWidth: 1920, screenWidth: 3840, devicePixelRatio: 2 });
  assert.equal(ratio, 2);
});

test("a browser that understates the ratio is not scaled below one", () => {
  const ratio = withScreen({ innerWidth: 1920, screenWidth: 960, devicePixelRatio: 1 });
  assert.equal(ratio, 1);
});

test("missing screen metrics fall back to one rather than throwing", () => {
  const ratio = withScreen({ innerWidth: 0, screenWidth: 0, devicePixelRatio: 0 });
  assert.equal(ratio, 1);
});

test("a stretched poster keeps the whole source, because fill never crops", () => {
  // Collection cards use object-fit: fill. Cropping one would change the
  // picture, so the source rectangle has to stay the whole image and only the
  // destination box shrinks.
  const rect = computeSourceRect(800, 450, 220, 338, "fill");
  assert.deepEqual(rect, { sx: 0, sy: 0, sw: 800, sh: 450 });
});

test("fill keeps the whole source whatever the box shape", () => {
  for (const [nw, nh] of [
    [200, 300],
    [1280, 720],
    [500, 500]
  ]) {
    assert.deepEqual(computeSourceRect(nw, nh, 220, 338, "fill"), { sx: 0, sy: 0, sw: nw, sh: nh });
  }
});

test("only the object-fit values the home cards use are rescalable", () => {
  assert.equal(isRescalableArtworkFit("cover"), true);
  assert.equal(isRescalableArtworkFit("fill"), true);
  for (const fit of ["contain", "none", "scale-down", "", undefined, null]) {
    assert.equal(isRescalableArtworkFit(fit), false, `${fit} must load untouched`);
  }
});

test("only JPEG bytes are accepted for re-encoding", () => {
  assert.equal(isJpegHeader(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), true);
  // PNG can carry transparency a JPEG would paint black.
  assert.equal(isJpegHeader(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), false);
  // GIF and animated WebP would lose every frame but the first.
  assert.equal(isJpegHeader(new Uint8Array([0x47, 0x49, 0x46, 0x38])), false);
  assert.equal(isJpegHeader(new Uint8Array([0x52, 0x49, 0x46, 0x46])), false);
  assert.equal(
    isJpegHeader(new Uint8Array([0xff, 0xd8])),
    false,
    "a truncated header is not a jpeg"
  );
  assert.equal(isJpegHeader(null), false);
});
