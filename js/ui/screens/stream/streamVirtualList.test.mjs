import test from "node:test";
import assert from "node:assert/strict";

import {
  VIRTUAL_LIST_FALLBACK_ROW_HEIGHT,
  VIRTUAL_LIST_OVERSCAN_ROWS,
  buildRowOffsets,
  computeVirtualRange,
  deriveRowStrides,
  estimateRowHeight,
  findRowAtOffset,
  projectScrollForRow,
  virtualRangeNeedsRefresh
} from "./streamVirtualList.js";

test("a row leaving the bottom is pinned to the bottom edge", () => {
  const offsets = buildRowOffsets([], 100, 100);
  // Viewport 0-600 shows rows 0-5; focusing row 6 (600-700) pins it to the bottom.
  const next = projectScrollForRow({
    offsets,
    row: 6,
    scrollTop: 0,
    viewportHeight: 600,
    pad: 16
  });
  assert.equal(next, 700 - 600 + 16);
});

test("a row leaving the top is pinned to the top edge", () => {
  const offsets = buildRowOffsets([], 100, 100);
  const next = projectScrollForRow({
    offsets,
    row: 3,
    scrollTop: 1000,
    viewportHeight: 600,
    pad: 16
  });
  assert.equal(next, 300 - 16);
});

test("a comfortably visible row does not move the list", () => {
  const offsets = buildRowOffsets([], 100, 100);
  const next = projectScrollForRow({
    offsets,
    row: 12,
    scrollTop: 1000,
    viewportHeight: 600,
    pad: 16
  });
  assert.equal(next, 1000, "row 12 sits at 1200-1300, well inside 1000-1600");
});

test("scroll projection never runs past the end of the content", () => {
  const total = 100;
  const offsets = buildRowOffsets([], total, 100);
  const maxScroll = offsets[total] - 600;
  const next = projectScrollForRow({
    offsets,
    row: total - 1,
    scrollTop: maxScroll - 10,
    viewportHeight: 600,
    pad: 16,
    maxScroll
  });
  assert.equal(next, maxScroll, "the last row clamps to the end of the content");
  assert.ok(next >= 0);
});

test("holding a direction walks the list edge to edge without stalling", () => {
  const total = 300;
  const viewport = 600;
  const offsets = buildRowOffsets([], total, 100);
  const maxScroll = offsets[total] - viewport;

  let scrollTop = 0;
  for (let row = 0; row < total; row += 1) {
    const next = projectScrollForRow({
      offsets,
      row,
      scrollTop,
      viewportHeight: viewport,
      pad: 16,
      maxScroll
    });
    assert.ok(next >= scrollTop, `row ${row} must not scroll backwards going down`);
    scrollTop = next;
    // The focused row is on screen at every single step.
    assert.ok(
      offsets[row] >= scrollTop - 1 && offsets[row + 1] <= scrollTop + viewport + 1,
      `row ${row} left the viewport`
    );
  }
  assert.equal(scrollTop, maxScroll, "must reach the very bottom");

  // And all the way back up.
  for (let row = total - 1; row >= 0; row -= 1) {
    const next = projectScrollForRow({
      offsets,
      row,
      scrollTop,
      viewportHeight: viewport,
      pad: 16,
      maxScroll
    });
    assert.ok(next <= scrollTop, `row ${row} must not scroll forwards going up`);
    scrollTop = next;
    assert.ok(
      offsets[row] >= scrollTop - 1 && offsets[row + 1] <= scrollTop + viewport + 1,
      `row ${row} left the viewport going up`
    );
  }
  assert.equal(scrollTop, 0, "must reach the very top");
});

test("row strides pick up the margin between rows from their offsets", () => {
  // Three stacked rows, 18px apart, starting below a 400px top spacer.
  const { strides, gap } = deriveRowStrides([
    { row: 10, top: 400, height: 200 },
    { row: 11, top: 618, height: 150 },
    { row: 12, top: 786, height: 240 }
  ]);
  assert.equal(gap, 18);
  assert.equal(strides.get(10), 218);
  assert.equal(strides.get(11), 168);
  // The last row has no successor, but still gets the inferred margin.
  assert.equal(strides.get(12), 258);
});

test("row strides ignore unmeasured rows and non-adjacent pairs", () => {
  const { strides, gap } = deriveRowStrides([
    { row: 4, top: 0, height: 100 },
    { row: 5, top: 110, height: 0 },
    { row: 9, top: 900, height: 100 }
  ]);
  // Row 5 has no box yet, so it contributes nothing and rows 4 and 9 are not
  // adjacent — no gap can be inferred from this window.
  assert.equal(gap, 0);
  assert.equal(strides.has(5), false);
  assert.equal(strides.get(4), 100);
});

test("row strides keep the last known margin when a window cannot infer one", () => {
  const { strides, gap } = deriveRowStrides([{ row: 2, top: 0, height: 120 }], 18);
  assert.equal(gap, 18);
  assert.equal(strides.get(2), 138);
});

test("row strides reject nonsensical gaps rather than poisoning the model", () => {
  // Overlapping rows (mid-render) would otherwise yield a negative margin.
  const { gap } = deriveRowStrides(
    [
      { row: 0, top: 0, height: 300 },
      { row: 1, top: 100, height: 300 }
    ],
    18
  );
  assert.equal(gap, 18);
});

test("unmeasured rows fall back to the average of the measured ones", () => {
  assert.equal(estimateRowHeight([]), VIRTUAL_LIST_FALLBACK_ROW_HEIGHT);
  assert.equal(estimateRowHeight([100, 200]), 150);

  const sparse = [];
  sparse[3] = 220;
  sparse[9] = 180;
  assert.equal(estimateRowHeight(sparse), 200);
  // Holes use the average, measured rows keep their own height.
  const offsets = buildRowOffsets(sparse, 5, estimateRowHeight(sparse));
  assert.deepEqual(offsets, [0, 200, 400, 600, 820, 1020]);
});

test("row offsets accumulate to the full content height", () => {
  const heights = [100, 150, 200, 250];
  const offsets = buildRowOffsets(heights, 4);
  assert.deepEqual(offsets, [0, 100, 250, 450, 700]);
  assert.equal(offsets[offsets.length - 1], 700);
});

test("findRowAtOffset lands on the row containing the offset", () => {
  const offsets = buildRowOffsets([100, 150, 200, 250], 4);
  assert.equal(findRowAtOffset(offsets, 0), 0);
  assert.equal(findRowAtOffset(offsets, 99), 0);
  // A boundary belongs to the row that starts there.
  assert.equal(findRowAtOffset(offsets, 100), 1);
  assert.equal(findRowAtOffset(offsets, 249), 1);
  assert.equal(findRowAtOffset(offsets, 250), 2);
  assert.equal(findRowAtOffset(offsets, 699), 3);
  // Past the end clamps to the last row rather than running off it.
  assert.equal(findRowAtOffset(offsets, 5000), 3);
  assert.equal(findRowAtOffset(offsets, -50), 0);
});

test("the window covers the viewport plus overscan on both sides", () => {
  const total = 300;
  const offsets = buildRowOffsets([], total, 100);
  const range = computeVirtualRange({
    offsets,
    scrollTop: 5000,
    viewportHeight: 600,
    total
  });
  assert.equal(range.first, 50);
  assert.equal(range.last, 56);
  assert.equal(range.start, 50 - VIRTUAL_LIST_OVERSCAN_ROWS);
  assert.equal(range.end, 56 + VIRTUAL_LIST_OVERSCAN_ROWS);
});

test("the window clamps at both ends of the list", () => {
  const total = 30;
  const offsets = buildRowOffsets([], total, 100);
  const top = computeVirtualRange({ offsets, scrollTop: 0, viewportHeight: 600, total });
  assert.equal(top.start, 0);
  const bottom = computeVirtualRange({
    offsets,
    scrollTop: 2400,
    viewportHeight: 600,
    total
  });
  assert.equal(bottom.end, total - 1);
});

test("a focused row far outside the viewport is still rendered", () => {
  const total = 300;
  const offsets = buildRowOffsets([], total, 100);
  const range = computeVirtualRange({
    offsets,
    scrollTop: 0,
    viewportHeight: 600,
    total,
    focusRow: 250
  });
  assert.ok(range.start <= 250 && range.end >= 250, "focused row must be in the window");
  // Around the focused row, not spanning from the viewport to it.
  assert.ok(range.start > 200, "window must not span the gap to a far focus row");
});

test("an empty list produces an empty window", () => {
  const range = computeVirtualRange({ offsets: [0], total: 0, viewportHeight: 600 });
  assert.equal(range.end < range.start, true);
});

test("the window is not rebuilt while the viewport stays clear of the overscan", () => {
  const total = 300;
  const offsets = buildRowOffsets([], total, 100);
  const current = { start: 44, end: 62 };
  const stillInside = computeVirtualRange({
    offsets,
    scrollTop: 5100,
    viewportHeight: 600,
    total
  });
  assert.equal(
    virtualRangeNeedsRefresh({ current, next: stillInside, total }),
    false,
    "a one-row step inside the overscan must not rebuild"
  );

  const nearEdge = computeVirtualRange({
    offsets,
    scrollTop: 4550,
    viewportHeight: 600,
    total
  });
  assert.equal(
    virtualRangeNeedsRefresh({ current, next: nearEdge, total }),
    true,
    "approaching the top of the window must rebuild"
  );
});

test("a window pinned at a list edge does not rebuild forever", () => {
  const total = 300;
  const offsets = buildRowOffsets([], total, 100);
  const atTop = computeVirtualRange({ offsets, scrollTop: 0, viewportHeight: 600, total });
  // start is already 0, so there is nothing above to extend into.
  assert.equal(
    virtualRangeNeedsRefresh({
      current: { start: atTop.start, end: atTop.end },
      next: atTop,
      total
    }),
    false
  );

  const lastOffset = offsets[total] - 600;
  const atBottom = computeVirtualRange({
    offsets,
    scrollTop: lastOffset,
    viewportHeight: 600,
    total
  });
  assert.equal(
    virtualRangeNeedsRefresh({
      current: { start: atBottom.start, end: atBottom.end },
      next: atBottom,
      total
    }),
    false
  );
});

test("a stale window from a longer list is always rebuilt", () => {
  const total = 10;
  const offsets = buildRowOffsets([], total, 100);
  const next = computeVirtualRange({ offsets, scrollTop: 0, viewportHeight: 600, total });
  assert.equal(
    virtualRangeNeedsRefresh({ current: { start: 40, end: 80 }, next, total }),
    true
  );
});

// End-to-end simulation: walk a 400-row list of ragged heights one row at a
// time, the way the D-pad does, and assert the invariants the screen relies on.
test("stepping through the whole list keeps the focused row rendered", () => {
  const total = 400;
  const viewport = 620;
  const pad = 16;
  // Real heights the screen would eventually measure; the model starts blind.
  const realHeights = Array.from({ length: total }, (_, index) => 120 + ((index * 37) % 180));
  const realOffsets = buildRowOffsets(realHeights, total);

  const measured = [];
  let current = null;
  let scrollTop = 0;
  let rebuilds = 0;

  for (let focusRow = 0; focusRow < total; focusRow += 1) {
    const offsets = buildRowOffsets(measured, total, estimateRowHeight(measured));
    const rowTop = offsets[focusRow];
    const rowBottom = offsets[focusRow + 1];
    let projected = scrollTop;
    if (rowBottom > scrollTop + viewport - pad) {
      projected = rowBottom - viewport + pad;
    } else if (rowTop < scrollTop + pad) {
      projected = rowTop - pad;
    }
    projected = Math.max(0, projected);

    const next = computeVirtualRange({
      offsets,
      scrollTop: projected,
      viewportHeight: viewport,
      total,
      focusRow
    });
    if (virtualRangeNeedsRefresh({ current, next, total })) {
      current = { start: next.start, end: next.end };
      rebuilds += 1;
      // Rendering the window measures exactly the rows it contains.
      for (let row = current.start; row <= current.end; row += 1) {
        measured[row] = realHeights[row];
      }
    }

    assert.ok(
      current && focusRow >= current.start && focusRow <= current.end,
      `row ${focusRow} must be inside the rendered window`
    );
    // The screen scrolls using real rects, so track the true position here.
    const trueTop = realOffsets[focusRow];
    const trueBottom = realOffsets[focusRow + 1];
    if (trueBottom > scrollTop + viewport - pad) {
      scrollTop = trueBottom - viewport + pad;
    } else if (trueTop < scrollTop + pad) {
      scrollTop = trueTop - pad;
    }
    scrollTop = Math.max(0, scrollTop);
    assert.ok(
      trueTop >= scrollTop - 1 && trueBottom <= scrollTop + viewport + 1,
      `row ${focusRow} must be visible after scrolling`
    );
  }

  // Windows are swapped in chunks, not on every step.
  assert.ok(rebuilds > 0, "the window must move while traversing the list");
  assert.ok(
    rebuilds < total / 2,
    `expected chunked rebuilds, got ${rebuilds} for ${total} rows`
  );
  // Every row got rendered, so every height ends up measured.
  assert.equal(measured.filter((height) => height > 0).length, total);
});

// Regression: badges used to be hydrated after a card was measured, so every
// row was recorded shorter than it really was. Holding Down then walked the real
// scroll position away from the model, and the window stretched from the model
// position all the way to the focused row until the list broke.
test("a window stays bounded when the model has drifted from the real scroll", () => {
  const total = 400;
  const viewport = 620;
  const offsets = buildRowOffsets([], total, 100);
  // Real rows are half again as tall as the model believes, so by row 200 the
  // real scroll position is thousands of pixels past the modelled one.
  const driftedScrollTop = 200 * 150;
  const range = computeVirtualRange({
    offsets,
    scrollTop: driftedScrollTop,
    viewportHeight: viewport,
    total,
    focusRow: 200
  });
  assert.ok(range.start <= 200 && range.end >= 200, "focused row must be resident");
  assert.ok(
    range.end - range.start + 1 <= 24,
    `window stretched to ${range.end - range.start + 1} rows under drift`
  );
});

test("a far jump renders around the target, not across the gap", () => {
  const total = 500;
  const offsets = buildRowOffsets([], total, 100);
  // Viewport at the top of the list, focus jumping to row 400.
  const range = computeVirtualRange({
    offsets,
    scrollTop: 0,
    viewportHeight: 600,
    total,
    focusRow: 400
  });
  assert.ok(range.start <= 400 && range.end >= 400);
  assert.ok(
    range.end - range.start + 1 <= 24,
    `window spanned ${range.end - range.start + 1} rows for a far jump`
  );
  assert.ok(range.start > 300, "window should sit around the jump target");
});

test("a focused row just outside the viewport still keeps the viewport resident", () => {
  const total = 300;
  const offsets = buildRowOffsets([], total, 100);
  // Rows 50-56 visible, focus on 58 — inside the overscan, so both are kept.
  const range = computeVirtualRange({
    offsets,
    scrollTop: 5000,
    viewportHeight: 600,
    total,
    focusRow: 58
  });
  assert.ok(range.start <= 50, "viewport rows must stay resident");
  assert.ok(range.end >= 58, "focused row must stay resident");
});

test("the window never exceeds a bounded size while traversing", () => {
  const total = 500;
  const viewport = 620;
  const offsets = buildRowOffsets([], total, 150);
  let worst = 0;
  for (let focusRow = 0; focusRow < total; focusRow += 1) {
    const range = computeVirtualRange({
      offsets,
      scrollTop: Math.max(0, offsets[focusRow] - viewport / 2),
      viewportHeight: viewport,
      total,
      focusRow
    });
    worst = Math.max(worst, range.end - range.start + 1);
  }
  // Viewport rows plus overscan on both sides — never the whole list.
  assert.ok(worst <= 24, `window grew to ${worst} rows`);
});
