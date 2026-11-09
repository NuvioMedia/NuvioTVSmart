import { test } from "node:test";
import assert from "node:assert/strict";

import {
  canRescaleArtworkHost,
  isLazyArtworkImage,
  startTvArtworkLazyLoader
} from "./tvArtworkLazyLoader.js";

function fakeImage(className = "") {
  return {
    nodeType: 1,
    tagName: "IMG",
    className,
    matches: (selector) =>
      selector
        .split(",")
        .map((entry) => entry.trim())
        .some((entry) => className.split(/\s+/).includes(entry.replace(/^\./, "")))
  };
}

test("only the poster surfaces outside Home are picked up", () => {
  assert.equal(isLazyArtworkImage(fakeImage("library-grid-poster-image")), true);
  assert.equal(isLazyArtworkImage(fakeImage("seeall-card-poster-image")), true);
  assert.equal(isLazyArtworkImage(fakeImage("detail-morelike-poster-image")), true);
  assert.equal(isLazyArtworkImage(fakeImage("search-result-poster")), true);
  assert.equal(isLazyArtworkImage(fakeImage("series-detail-logo")), false);
  assert.equal(isLazyArtworkImage({ nodeType: 1, tagName: "DIV", matches: () => true }), false);
  assert.equal(isLazyArtworkImage(null), false);
});

test("the loader stays inert on a non-TV runtime", () => {
  assert.equal(startTvArtworkLazyLoader(), false);
});

test("only CORS-safe artwork hosts use the worker resize path", () => {
  assert.equal(canRescaleArtworkHost("https://image.tmdb.org/t/p/w500/x.jpg"), true);
  assert.equal(canRescaleArtworkHost("//image.tmdb.org/t/p/w500/x.jpg"), true);
  assert.equal(canRescaleArtworkHost("https://addon.example/poster.jpg"), false);
  assert.equal(canRescaleArtworkHost("not a url"), false);
  assert.equal(canRescaleArtworkHost(""), false);
});
