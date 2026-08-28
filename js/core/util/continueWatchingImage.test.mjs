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
  assert.deepEqual(sources, ["poster.jpg", "backdrop.jpg"]);
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
  assert.deepEqual(sources, ["episode.jpg", "backdrop.jpg", "poster.jpg"]);
});

test("card style next up not aired keeps the episode still last", () => {
  const sources = continueWatchingImageSources(art, {
    cardStyle: "card",
    useEpisodeThumbnails: true,
    isNextUp: true,
    hasAired: false
  });
  assert.deepEqual(sources, ["backdrop.jpg", "poster.jpg", "thumbnail.jpg"]);
});

test("card style next up aired leads with the thumbnail", () => {
  const sources = continueWatchingImageSources(art, {
    cardStyle: "card",
    useEpisodeThumbnails: true,
    isNextUp: true,
    hasAired: true
  });
  assert.deepEqual(sources, ["thumbnail.jpg", "backdrop.jpg", "poster.jpg"]);
});

test("thumbnails off excludes episode artwork from the fallback chain", () => {
  const sources = continueWatchingImageSources(art, {
    cardStyle: "card",
    useEpisodeThumbnails: false,
    isNextUp: false,
    hasAired: true
  });
  assert.deepEqual(sources, ["backdrop.jpg", "poster.jpg"]);
  assert.ok(!sources.includes("episode.jpg"));
  assert.ok(!sources.includes("thumbnail.jpg"));
});

test("wide style uses poster-art ordering while thumbnails are enabled", () => {
  const wide = continueWatchingImageSources(art, {
    cardStyle: "wide",
    useEpisodeThumbnails: true,
    isNextUp: false,
    hasAired: true
  });
  assert.deepEqual(wide, ["episode.jpg", "poster.jpg", "backdrop.jpg"]);
});

test("wide next up uses the next-up thumbnail before poster art", () => {
  const sources = continueWatchingImageSources(art, {
    cardStyle: "wide",
    useEpisodeThumbnails: true,
    isNextUp: true,
    hasAired: true
  });
  assert.deepEqual(sources, ["thumbnail.jpg", "poster.jpg", "backdrop.jpg"]);
});

test("wide style excludes thumbnails when the preference is disabled", () => {
  const sources = continueWatchingImageSources(art, {
    cardStyle: "wide",
    useEpisodeThumbnails: false,
    isNextUp: false,
    hasAired: true
  });
  assert.deepEqual(sources, ["poster.jpg", "backdrop.jpg"]);
});

test("card style keeps an unaired next up thumbnail as a last resort", () => {
  const sources = continueWatchingImageSources(art, {
    cardStyle: "card",
    useEpisodeThumbnails: true,
    isNextUp: true,
    hasAired: false
  });
  assert.deepEqual(sources, ["backdrop.jpg", "poster.jpg", "thumbnail.jpg"]);
});

test("card style with thumbnails disabled does not use an unaired next up thumbnail", () => {
  const sources = continueWatchingImageSources(art, {
    cardStyle: "card",
    useEpisodeThumbnails: false,
    isNextUp: true,
    hasAired: false
  });
  assert.deepEqual(sources, ["backdrop.jpg", "poster.jpg"]);
});

test("card style normalization is case insensitive", () => {
  assert.equal(continueWatchingUsesEpisodeThumbnails(" POSTER ", true), false);
  assert.deepEqual(
    continueWatchingImageSources(art, {
      cardStyle: " WIDE ",
      useEpisodeThumbnails: true,
      isNextUp: false
    }),
    ["episode.jpg", "poster.jpg", "backdrop.jpg"]
  );
});
