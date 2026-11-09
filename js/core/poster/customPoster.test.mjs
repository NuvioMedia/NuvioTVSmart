import { test } from "node:test";
import assert from "node:assert/strict";

import { customPosterForItem, posterFallbackAttributes } from "./customPoster.js";

const SETTINGS = { customPosterUrlPattern: "", customPosterEnabledScreens: [] };

test("every screen gets the same bounded TMDB artwork as Home", () => {
  const item = customPosterForItem(
    {
      id: "tt1",
      poster: "https://image.tmdb.org/t/p/original/poster.jpg",
      backdrop: "https://image.tmdb.org/t/p/original/backdrop.jpg",
      landscapePoster: "https://image.tmdb.org/t/p/w780/landscape.jpg"
    },
    "library",
    "poster",
    SETTINGS
  );
  assert.equal(item.poster, "https://image.tmdb.org/t/p/w500/poster.jpg");
  assert.equal(item.backdrop, "https://image.tmdb.org/t/p/w1280/backdrop.jpg");
  assert.equal(item.landscapePoster, "https://image.tmdb.org/t/p/w1280/landscape.jpg");
});

test("non-TMDB and custom poster URLs are left byte-for-byte unchanged", () => {
  const item = customPosterForItem(
    {
      id: "tt1",
      poster: "https://addon.example/art/poster.webp?token=abc",
      background: "https://addon.example/art/backdrop.jpg"
    },
    "search",
    "poster",
    SETTINGS
  );
  assert.equal(item.poster, "https://addon.example/art/poster.webp?token=abc");
  assert.equal(item.background, "https://addon.example/art/backdrop.jpg");
});

test("the custom-poster fallback keeps the bounded TMDB size too", () => {
  const attributes = posterFallbackAttributes({
    rawPosterUrl: "https://image.tmdb.org/t/p/original/fallback.jpg"
  });
  assert.equal(attributes, ' data-original-poster="https://image.tmdb.org/t/p/w500/fallback.jpg"');
});
