import assert from "node:assert/strict";
import test from "node:test";

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key)
};
const { getHomeGridColumnCount, chunkHomeGridCards } =
  await import("./homeScreenHelpers-14-get-home-grid-column-count.js");

function withStyle(style, run) {
  const previous = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => style;
  try {
    return run();
  } finally {
    globalThis.getComputedStyle = previous;
  }
}

// Measured in Chromium with the app CSS: a 1728px track, 12px gap, 236.5625px cells.
const track = { clientWidth: 1728, getBoundingClientRect: () => ({ width: 1728 }) };
const card = { offsetWidth: 237, getBoundingClientRect: () => ({ width: 236.5625 }) };

test("a CSS grid track counts its resolved columns", () => {
  const style = {
    display: "grid",
    columnGap: "12px",
    gridTemplateColumns: Array(7).fill("236.562px").join(" ")
  };
  assert.equal(
    withStyle(style, () => getHomeGridColumnCount(track, [card])),
    7
  );
});

test("the width fallback uses the fractional card width, not the rounded one", () => {
  const style = { display: "flex", columnGap: "12px", gridTemplateColumns: "none" };
  assert.equal(
    withStyle(style, () => getHomeGridColumnCount(track, [card])),
    7
  );
});

test("a track without layout (parked on webOS 6) gives no count", () => {
  const hidden = { clientWidth: 0, getBoundingClientRect: () => ({ width: 0 }) };
  const hiddenCard = { offsetWidth: 0, offsetTop: 0, getBoundingClientRect: () => ({ width: 0 }) };
  const style = { display: "none", columnGap: "12px", gridTemplateColumns: "none" };
  assert.equal(
    withStyle(style, () => getHomeGridColumnCount(hidden, [hiddenCard, hiddenCard])),
    null
  );
});

test("grid cards are grouped into rows of the column count", () => {
  const cards = Array.from({ length: 10 }, (_, index) => index);
  assert.deepEqual(chunkHomeGridCards(cards, 7), [
    [0, 1, 2, 3, 4, 5, 6],
    [7, 8, 9]
  ]);
  assert.deepEqual(chunkHomeGridCards(cards.slice(0, 3), 7), [[0, 1, 2]]);
});
