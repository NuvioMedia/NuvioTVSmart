import { test } from "node:test";
import assert from "node:assert/strict";

import { toTraktImageUrl } from "./traktImageUrl.js";

test("normalizes trakt image hosts to https", () => {
  assert.equal(
    toTraktImageUrl("media.trakt.tv/images/movies/poster.jpg.webp"),
    "https://media.trakt.tv/images/movies/poster.jpg.webp"
  );
  assert.equal(
    toTraktImageUrl("//media.trakt.tv/images/movies/poster.jpg.webp"),
    "https://media.trakt.tv/images/movies/poster.jpg.webp"
  );
  assert.equal(
    toTraktImageUrl("http://media.trakt.tv/images/movies/poster.jpg.webp"),
    "https://media.trakt.tv/images/movies/poster.jpg.webp"
  );
});

test("keeps an https url unchanged", () => {
  assert.equal(
    toTraktImageUrl("https://walter-r2.trakt.tv/images/movies/poster.jpg.webp"),
    "https://walter-r2.trakt.tv/images/movies/poster.jpg.webp"
  );
});

test("leaves non trakt urls alone", () => {
  assert.equal(
    toTraktImageUrl("image.tmdb.org/t/p/w342/poster.jpg"),
    "image.tmdb.org/t/p/w342/poster.jpg"
  );
  assert.equal(toTraktImageUrl(""), "");
});
