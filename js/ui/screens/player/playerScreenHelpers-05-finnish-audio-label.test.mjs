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

test("every legacy-engine fallback key has an English and an Italian name", async () => {
  // Chromium before 81 (Tizen 5.x/6.0, webOS 6) has no Intl.DisplayNames: this
  // table is the only source of language names there, otherwise "CS" or "DA".
  const { readFile } = await import("node:fs/promises");
  const keys = (path) =>
    readFile(new URL(path, import.meta.url), "utf8").then(
      (xml) => new Set([...xml.matchAll(/name="(common\.[a-z]+)"/g)].map((match) => match[1]))
    );
  const [english, italian] = await Promise.all([
    keys("../../../../res/values/strings.xml"),
    keys("../../../../res/values-it/strings.xml")
  ]);
  for (const code of ["cs", "da", "no", "nb", "mk", "el", "he", "uk", "th"]) {
    const key = AUDIO_TRACK_LANGUAGE_KEY_BY_CODE[code];
    assert.ok(key, `fallback key for ${code}`);
    assert.ok(english.has(key) && italian.has(key), `${key} is translated`);
  }
  for (const key of new Set(Object.values(AUDIO_TRACK_LANGUAGE_KEY_BY_CODE))) {
    assert.ok(english.has(key), `${key} exists in the base strings`);
  }
});
