import assert from "node:assert/strict";
import test from "node:test";
import { jsPluginMediaType, pluginSupportsType } from "./pluginModels.js";

test("series scrapers serve the TMDB tv type, as on Android", () => {
  assert.equal(pluginSupportsType(["movie", "series"], "tv"), true);
  assert.equal(pluginSupportsType(["movie", "series"], "series"), true);
  assert.equal(pluginSupportsType(["tv"], "series"), true);
  assert.equal(pluginSupportsType(["show"], "tv"), true);
  assert.equal(pluginSupportsType(["movie"], "tv"), false);
  assert.equal(pluginSupportsType(["series"], "movie"), false);
});

test("an episode reaches a series scraper as series", () => {
  assert.equal(jsPluginMediaType("tv", ["movie", "series"], 1, 1), "series");
  assert.equal(jsPluginMediaType("TV", ["SERIES", "tv"], 0, 1), "series");
  assert.equal(jsPluginMediaType("tv", ["tv"], 1, 1), "tv");
  assert.equal(jsPluginMediaType("tv", ["series"], null, null), "tv");
  assert.equal(jsPluginMediaType("movie", ["movie", "series"], null, null), "movie");
});
