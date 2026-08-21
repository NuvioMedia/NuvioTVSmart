import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hasOnlyImplicitStartupAudioOptions,
  selectStartupAudioFallbackOption
} from "../../../js/core/player/startupAudioGatePolicy.js";

const implicitOption = {
  id: "audio-implicit-0",
  supported: true,
  selected: true,
  languageKey: "",
  entry: { implicitAudioTrack: true }
};
const realOption = (languageKey) => ({
  id: `audio-avplay-${languageKey}`,
  supported: true,
  selected: false,
  languageKey,
  entry: {}
});

test("treats a missing audio option list as placeholder-only", () => {
  assert.equal(hasOnlyImplicitStartupAudioOptions([]), true);
  assert.equal(hasOnlyImplicitStartupAudioOptions(), true);
  assert.equal(hasOnlyImplicitStartupAudioOptions(null), true);
});

test("treats the synthetic startup entry as placeholder-only", () => {
  // Tizen AVPlay exposes no track list until after loadedmetadata, so the
  // implicit entry must not settle the preferred-language decision.
  assert.equal(hasOnlyImplicitStartupAudioOptions([implicitOption]), true);
});

test("stops waiting once a real audio track is exposed", () => {
  assert.equal(hasOnlyImplicitStartupAudioOptions([realOption("en")]), false);
  assert.equal(hasOnlyImplicitStartupAudioOptions([implicitOption, realOption("fr")]), false);
});

test("startup fallback still prefers the already selected supported track", () => {
  const options = [realOption("fr"), { ...realOption("en"), selected: true }];
  assert.equal(selectStartupAudioFallbackOption(options).languageKey, "en");
});
