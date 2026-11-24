import test from "node:test";
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};
const { nextRatingValue, formatRating } = await import("../js/ui/components/ratingDialog.js");

// Android RatingStars select() and formatRating (c4b07d284).
test("stars move one point at a time within 1..10, digits jump and 0 means 10", () => {
  assert.equal(nextRatingValue(0, { step: 1 }), 1);
  assert.equal(nextRatingValue(1, { step: -1 }), 1);
  assert.equal(nextRatingValue(10, { step: 1 }), 10);
  assert.equal(nextRatingValue(5, { step: 1 }, true), 4, "RTL reverses Left/Right");
  assert.equal(nextRatingValue(3, { digit: 7 }), 7);
  assert.equal(nextRatingValue(3, { digit: 0 }), 10);
  assert.equal(formatRating(8), "8");
  assert.equal(formatRating(7.5), "7.5");
});
