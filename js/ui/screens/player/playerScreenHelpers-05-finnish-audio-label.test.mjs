import assert from "node:assert/strict";
import { test } from "node:test";

import { LANGUAGE_NAME_ALIASES } from "./playerScreenHelpers-02-language-code-aliases.js";
import {
  inferAudioTrackLanguageKey,
  inferTrackLanguageCodeFromText
} from "./playerScreenHelpers-05-normalize-track-language-code.js";
import { AUDIO_TRACK_LANGUAGE_KEY_BY_CODE } from "./playerScreenHelpers-01-clock-formatter-cache.js";

test("Finnish human-readable names resolve to fi", () => {
  assert.equal(LANGUAGE_NAME_ALIASES.finnish, "fi");
  assert.equal(LANGUAGE_NAME_ALIASES.suomi, "fi");
  assert.equal(inferTrackLanguageCodeFromText("Finnish"), "fi");
  assert.equal(inferTrackLanguageCodeFromText("Suomi"), "fi");
});

test("explicit fi code wins over conflicting French display label", () => {
  assert.equal(inferAudioTrackLanguageKey({ language: "fi", label: "French" }, {}), "fi");
  assert.equal(inferAudioTrackLanguageKey({ language: "fin", title: "French" }, {}), "fi");
});

test("regional refinement within the same base still applies", () => {
  assert.equal(
    inferAudioTrackLanguageKey({ language: "pt", label: "Brazilian Portuguese" }, {}),
    "pt-br"
  );
});

test("fi has a legacy-engine fallback label key", () => {
  assert.equal(AUDIO_TRACK_LANGUAGE_KEY_BY_CODE.fi, "common.finnish");
});
