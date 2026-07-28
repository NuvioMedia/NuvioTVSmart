// Geometry for the stream picker's virtual list.
//
// Stream cards are not a uniform height — description lines and badge wrapping
// both change it — so the row model is measured where it can be and estimated
// everywhere else. Nothing here touches the DOM: these functions only decide
// which rows are worth rendering and how tall the spacers standing in for the
// rest should be. The screen anchors the visible content across every window
// swap, so an estimate being wrong costs a spacer resize, never a visible jump.

export const VIRTUAL_LIST_FALLBACK_ROW_HEIGHT = 150;
export const VIRTUAL_LIST_FALLBACK_VIEWPORT_PX = 720;
export const VIRTUAL_LIST_OVERSCAN_ROWS = 6;
export const VIRTUAL_LIST_REFRESH_MARGIN_ROWS = 2;

function toCount(value) {
  const count = Math.floor(Number(value || 0));
  return count > 0 ? count : 0;
}

export function estimateRowHeight(rowHeights = []) {
  let sum = 0;
  let count = 0;
  rowHeights.forEach((height) => {
    if (Number(height) > 0) {
      sum += Number(height);
      count += 1;
    }
  });
  return count ? sum / count : VIRTUAL_LIST_FALLBACK_ROW_HEIGHT;
}

// offsets[i] is the top of row i; offsets[total] is the full content height.
export function buildRowOffsets(rowHeights = [], total = 0, estimate = 0) {
  const count = toCount(total);
  const fallback =
    Number(estimate) > 0 ? Number(estimate) : estimateRowHeight(rowHeights);
  const offsets = new Array(count + 1);
  offsets[0] = 0;
  for (let index = 0; index < count; index += 1) {
    const measured = Number(rowHeights[index] || 0);
    offsets[index + 1] = offsets[index] + (measured > 0 ? measured : fallback);
  }
  return offsets;
}

// Index of the row containing `offset`, clamped to the row range.
export function findRowAtOffset(offsets = [0], offset = 0) {
  const lastRow = Math.max(0, offsets.length - 2);
  const target = Math.max(0, Number(offset || 0));
  let low = 0;
  let high = lastRow;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (offsets[mid + 1] <= target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

// Turns measurements of the rendered window into per-row strides (box height
// plus the margin between rows). The margin is inferred from the gap between
// two consecutive rows' offsetTops rather than read from computed style, which
// would cost a style resolve per row. `previousGap` carries the last inferred
// margin so the final row of a window — which has no successor to measure
// against — still gets a correct stride.
export function deriveRowStrides(measurements = [], previousGap = 0) {
  const rows = measurements
    .filter((entry) => Number(entry?.height) > 0)
    .sort((left, right) => left.row - right.row);
  let gap = Number(previousGap) > 0 ? Number(previousGap) : 0;
  for (let index = 0; index + 1 < rows.length; index += 1) {
    if (rows[index + 1].row !== rows[index].row + 1) {
      continue;
    }
    const candidate = rows[index + 1].top - rows[index].top - rows[index].height;
    // A negative or absurd gap means the rows were not laid out as a simple
    // vertical stack (mid-render, or a wrapped/absolute row); keep the old one.
    if (candidate >= 0 && candidate < 200) {
      gap = candidate;
    }
  }
  const strides = new Map();
  rows.forEach((entry) => {
    strides.set(entry.row, entry.height + gap);
  });
  return { strides, gap };
}

// Where the list must be scrolled for `row` to be visible, in model
// coordinates. A row leaving the bottom of the viewport is pinned to the bottom
// edge and one leaving the top is pinned to the top edge, so holding a direction
// scrolls the list underneath a focus marker that stays on screen. Returns the
// current offset unchanged when the row is already comfortably visible.
export function projectScrollForRow({
  offsets = [0],
  row = 0,
  scrollTop = 0,
  viewportHeight = 0,
  pad = 0,
  maxScroll = Number.POSITIVE_INFINITY
} = {}) {
  const index = Math.max(0, Math.floor(Number(row || 0)));
  const top = Number(offsets[index] ?? 0);
  const bottom = Number(offsets[index + 1] ?? top);
  const viewport =
    Number(viewportHeight) > 0 ? Number(viewportHeight) : VIRTUAL_LIST_FALLBACK_VIEWPORT_PX;
  const current = Math.max(0, Number(scrollTop || 0));
  let next = current;
  if (bottom > current + viewport - pad) {
    next = bottom - viewport + pad;
  } else if (top < current + pad) {
    next = top - pad;
  }
  return Math.min(Math.max(0, next), Math.max(0, Number(maxScroll)));
}

export function computeVirtualRange({
  offsets = [0],
  scrollTop = 0,
  viewportHeight = 0,
  total = 0,
  focusRow = null,
  overscan = VIRTUAL_LIST_OVERSCAN_ROWS
} = {}) {
  const count = toCount(total);
  if (!count) {
    return { start: 0, end: -1, first: 0, last: -1, requiredStart: 0, requiredEnd: -1 };
  }
  const viewport =
    Number(viewportHeight) > 0 ? Number(viewportHeight) : VIRTUAL_LIST_FALLBACK_VIEWPORT_PX;
  const top = Math.max(0, Number(scrollTop || 0));
  const first = findRowAtOffset(offsets, top);
  const last = findRowAtOffset(offsets, top + viewport);
  // The rows that must be resident: everything on screen, plus the focused row,
  // which focus and rect maths both need in the DOM even when it is off screen.
  let requiredStart = first;
  let requiredEnd = last;
  // Guard the nullish cases explicitly: Number(null) is 0, which would silently
  // pin row 0 as resident and stretch every window back to the top of the list.
  const focus =
    focusRow === null || focusRow === undefined ? Number.NaN : Number(focusRow);
  if (Number.isFinite(focus) && focus >= 0 && focus < count) {
    if (focus < first - overscan || focus > last + overscan) {
      // The focused row is nowhere near the viewport, either because the screen
      // is about to jump there or because the geometry model has drifted out of
      // step with the real scroll position. Either way the caller scrolls to the
      // focused row immediately after, so render around it rather than spanning
      // the gap — spanning is what turns drift into a window the size of the
      // whole list.
      requiredStart = focus;
      requiredEnd = focus;
    } else {
      requiredStart = Math.min(requiredStart, focus);
      requiredEnd = Math.max(requiredEnd, focus);
    }
  }
  return {
    start: Math.max(0, requiredStart - overscan),
    end: Math.min(count - 1, requiredEnd + overscan),
    first,
    last,
    requiredStart,
    requiredEnd
  };
}

// Rebuild only once the viewport eats into the overscan, so stepping one row at
// a time swaps the window every few rows instead of on every keypress.
export function virtualRangeNeedsRefresh({
  current = null,
  next = null,
  total = 0,
  margin = VIRTUAL_LIST_REFRESH_MARGIN_ROWS
} = {}) {
  if (!next) {
    return false;
  }
  if (!current || current.end < current.start) {
    return true;
  }
  const count = toCount(total);
  if (!count) {
    return false;
  }
  if (current.end > count - 1) {
    return true;
  }
  // Compare against the rows that must be resident, not the overscan-expanded
  // window: the expanded window grows past the current one on the very first
  // step, which would rebuild on every keypress and defeat the overscan.
  const requiredStart = Number(next.requiredStart ?? next.first ?? next.start);
  const requiredEnd = Number(next.requiredEnd ?? next.last ?? next.end);
  if (requiredStart < current.start || requiredEnd > current.end) {
    return true;
  }
  if (current.start > 0 && requiredStart - current.start < margin) {
    return true;
  }
  if (current.end < count - 1 && current.end - requiredEnd < margin) {
    return true;
  }
  return false;
}
