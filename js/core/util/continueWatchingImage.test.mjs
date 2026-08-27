import { test } from "node:test";
import assert from "node:assert/strict";

import {
  continueWatchingUsesEpisodeThumbnails,
  continueWatchingImageSources
} from "./continueWatchingImage.js";

const art = {
  poster: "poster.jpg",
  backdrop: "backdrop.jpg",
  thumbnail: "thumbnail.jpg",
  episodeThumbnail: "episode.jpg",
  background: "background.jpg"
};

test("poster style disables episode thumbnails regardless of the setting", () => {
  assert.equal(continueWatchingUsesEpisodeThumbnails("poster", true), false);
  assert.equal(continueWatchingUsesEpisodeThumbnails("card", true), true);
  assert.equal(continueWatchingUsesEpisodeThumbnails("wide", true), true);
  assert.equal(continueWatchingUsesEpisodeThumbnails("card", false), false);
  assert.equal(continueWatchingUsesEpisodeThumbnails(undefined, true), true);
});

test("poster style prefers poster then backdrop, never the episode still", () => {
  const sources = continueWatchingImageSources(art, {
    cardStyle: "poster",
    useEpisodeThumbnails: true,
    isNextUp: true,
    hasAired: true
  });
  assert.deepEqual(sources, ["poster.jpg", "backdrop.jpg", "background.jpg"]);
  assert.ok(!sources.includes("episode.jpg"));
  assert.ok(!sources.includes("thumbnail.jpg"));
});

test("card style with thumbnails on and not next up leads with the episode thumbnail", () => {
  const sources = continueWatchingImageSources(art, {
    cardStyle: "card",
    useEpisodeThumbnails: true,
    isNextUp: false,
    hasAired: true
  });
  assert.deepEqual(sources, [
    "episode.jpg",
    "backdrop.jpg",
    "poster.jpg",
    "thumbnail.jpg",
    "background.jpg"
  ]);
});

test("card style next up not aired keeps the episode still last", () => {
  const sources = continueWatchingImageSources(art, {
    cardStyle: "card",
    useEpisodeThumbnails: true,
    isNextUp: true,
    hasAired: false
  });
  assert.deepEqual(sources, [
    "backdrop.jpg",
    "poster.jpg",
    "thumbnail.jpg",
    "background.jpg",
    "episode.jpg"
  ]);
});

test("card style next up aired leads with the thumbnail", () => {
  const sources = continueWatchingImageSources(art, {
    cardStyle: "card",
    useEpisodeThumbnails: true,
    isNextUp: true,
    hasAired: true
  });
  assert.deepEqual(sources, [
    "thumbnail.jpg",
    "episode.jpg",
    "backdrop.jpg",
    "poster.jpg",
    "background.jpg"
  ]);
});

test("thumbnails off leads with the backdrop and keeps the episode still low", () => {
  const sources = continueWatchingImageSources(art, {
    cardStyle: "card",
    useEpisodeThumbnails: false,
    isNextUp: false,
    hasAired: true
  });
  assert.deepEqual(sources, [
    "backdrop.jpg",
    "poster.jpg",
    "thumbnail.jpg",
    "episode.jpg",
    "background.jpg"
  ]);
});

test("wide style behaves like card style for the episode thumbnail order", () => {
  const wide = continueWatchingImageSources(art, {
    cardStyle: "wide",
    useEpisodeThumbnails: true,
    isNextUp: false,
    hasAired: true
  });
  const card = continueWatchingImageSources(art, {
    cardStyle: "card",
    useEpisodeThumbnails: true,
    isNextUp: false,
    hasAired: true
  });
  assert.deepEqual(wide, card);
});
