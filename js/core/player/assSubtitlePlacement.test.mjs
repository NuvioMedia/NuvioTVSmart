import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { applyAssSubtitlePlacement } from "./assSubtitlePlacement.js";

test("applyAssSubtitlePlacement reuses caller-supplied measuredBox without extra getBoundingClientRect calls", async () => {
  let getRectCalls = 0;
  const makeDialogue = (y, height = 40) => ({
    $div: { style: { top: "" } },
    align: { v: 0 },
    y,
    height,
    slices: [{ style: "Default", fragments: [{ tag: {} }] }]
  });

  const d1 = makeDialogue(950);
  const d2 = makeDialogue(1020);
  const store = {
    height: 1080,
    playerSubtitlePlacement: { viewportBottom: 1000, overlayTop: 900, userOffsetPx: 0 },
    actives: [d1, d2],
    box: {
      getBoundingClientRect() {
        getRectCalls += 1;
        return { top: 0, bottom: 1080, height: 1080 };
      }
    }
  };

  const sharedBox = store.box.getBoundingClientRect();
  assert.equal(applyAssSubtitlePlacement(d1, store, null, sharedBox), true);
  assert.equal(applyAssSubtitlePlacement(d2, store, null, sharedBox), true);
  assert.equal(
    getRectCalls,
    1,
    "reusing measuredBox must avoid redundant getBoundingClientRect calls"
  );
  assert.notEqual(d1.$div.style.top, "");
  assert.notEqual(d2.$div.style.top, "");

  const runtimeSource = await readFile(
    new URL("../../../scripts/assSubtitleRuntime.mjs", import.meta.url),
    "utf8"
  );
  assert.match(runtimeSource, /placementBox/);
});
