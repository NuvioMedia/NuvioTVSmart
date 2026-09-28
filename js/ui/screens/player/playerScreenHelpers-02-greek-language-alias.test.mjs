import assert from "node:assert/strict";
import { test } from "node:test";

import { LANGUAGE_NAME_ALIASES } from "./playerScreenHelpers-02-language-code-aliases.js";
import { inferTrackLanguageCodeFromText } from "./playerScreenHelpers-05-normalize-track-language-code.js";
import { normalizeSubtitleLanguageKey } from "./playerScreenHelpers-09-format-bytes.js";

test("Greek human-readable names resolve to el instead of Unknown", () => {
  assert.equal(LANGUAGE_NAME_ALIASES.greek, "el");
  assert.equal(inferTrackLanguageCodeFromText("Greek"), "el");
  assert.equal(inferTrackLanguageCodeFromText("ELLINIKA"), "el");
  assert.equal(normalizeSubtitleLanguageKey("Greek"), "el");
});

test("existing French mapping is unchanged", () => {
  assert.equal(LANGUAGE_NAME_ALIASES.french, "fr");
  assert.equal(inferTrackLanguageCodeFromText("French"), "fr");
});
