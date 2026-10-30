import test from "node:test";
import assert from "node:assert/strict";
import { CUSTOM_POSTER_SCREENS, toggleCustomPosterScreen } from "./customPosterScreens.js";

test("custom poster screen toggles keep canonical order and preserve unsupported screens", () => {
  assert.deepEqual(toggleCustomPosterScreen(CUSTOM_POSTER_SCREENS, "home"), [
    "continue_watching",
    "collections",
    "library",
    "search",
    "details",
    "tv_recommendations"
  ]);
  assert.deepEqual(
    toggleCustomPosterScreen(toggleCustomPosterScreen(CUSTOM_POSTER_SCREENS, "home"), "home"),
    CUSTOM_POSTER_SCREENS
  );
  assert.deepEqual(toggleCustomPosterScreen(undefined, "details"), [
    "home",
    "continue_watching",
    "collections",
    "library",
    "search",
    "tv_recommendations"
  ]);
});
