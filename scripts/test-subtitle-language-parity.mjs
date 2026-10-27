import assert from "node:assert/strict";
const stored = new Map();
globalThis.localStorage = {
  getItem: (k) => stored.get(k) ?? null,
  setItem: (k, v) => stored.set(k, v),
  removeItem: (k) => stored.delete(k)
};
const {
  normalizeSubtitleLanguageAlias,
  normalizeHbsLanguageAlias,
  normalizeOpenSubtitlesSpanishCode
} = await import("../js/core/player/subtitleLanguageAliases.js");
const { normalizeTrackLanguageCode } =
  await import("../js/ui/screens/player/playerScreenHelpers-05-normalize-track-language-code.js");
const { normalizeSubtitleLanguageKey } =
  await import("../js/ui/screens/player/playerScreenHelpers-09-format-bytes.js");
const { decodeSubtitleBytes } = await import("../js/core/player/subtitleCharsetDetector.js");
const { languageEmoji } =
  await import("../js/core/debrid/debridStreamPresentationHelpers-04-compare-key.js");
const { languageFor, languagesFromText } =
  await import("../js/core/debrid/debridStreamPresentationHelpers-02-has-token.js");
const { createPlayerScreenMethods49 } =
  await import("../js/ui/screens/player/playerScreenMethods-49-collect-subtitle-option-items.js");
const { createPlayerScreenMethods52 } =
  await import("../js/ui/screens/player/playerScreenMethods-52-apply-startup-audio-fallback.js");
for (const input of ["spn", "SPN", " sp ", "esp", "ESP"]) {
  assert.equal(normalizeTrackLanguageCode(input), "es", input);
  assert.equal(normalizeSubtitleLanguageKey(input), "es", input);
  assert.equal(languageFor(input.trim()), "ES", input);
}
for (const [input, expected] of [
  ["spl", "es-419"],
  ["es-419", "es-419"],
  ["es_419", "es-419"],
  ["pt-br", "pt-br"],
  ["msa", "ms"],
  ["Bahasa Indonesia", "id"]
]) {
  assert.equal(normalizeSubtitleLanguageKey(input), expected, input);
}
assert.equal(normalizeTrackLanguageCode("spn_ES"), "es-es");
assert.equal(normalizeTrackLanguageCode("esp-AR"), "es-ar");
for (const [code, expected] of [
  ["srp", "sr"],
  ["hrv", "hr"],
  ["bos", "bs"]
]) {
  for (const separator of ["-", "_", ".", "/", " ", ""]) {
    const input = `HBS${separator}${code.toUpperCase()}`;
    assert.equal(normalizeSubtitleLanguageAlias(input), expected, input);
    assert.equal(normalizeTrackLanguageCode(input), expected, input);
    assert.equal(normalizeSubtitleLanguageKey(input), expected, input);
  }
}
for (const input of ["hbs", "hbs-unknown", "hbs-srp-hrv", "hbs-constructor", "constructor"]) {
  assert.equal(normalizeHbsLanguageAlias(input), "", input);
  assert.equal(normalizeOpenSubtitlesSpanishCode(input), "", input);
  assert.equal(normalizeSubtitleLanguageAlias(input), "", input);
}
assert.equal(normalizeSubtitleLanguageKey("hbs"), "hbs", "unqualified HBS remains unqualified");
assert.equal(normalizeSubtitleLanguageKey("eng"), "en");
for (const input of ["spn", "esp", "SPN"]) {
  assert.equal(languageEmoji(input), "🇪🇸");
  // Explicit language hints win even when the bytes look Cyrillic to heuristics.
  assert.equal(
    decodeSubtitleBytes(new Uint8Array([0xe0, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5]), {
      languageHint: input
    }),
    "àáâãäå"
  );
  assert.equal(
    decodeSubtitleBytes(new TextEncoder().encode("Español: acción"), { languageHint: input }),
    "Español: acción"
  );
}
assert.equal(
  decodeSubtitleBytes(new Uint8Array([0xff, 0xfe, 0x41, 0]), { languageHint: "spn" }),
  "A"
);
assert.deepEqual(languagesFromText(["spn", "esp"]), ["ES", "ES"]);
// Android release-name aliases use whole tokens; parsed languages take precedence.
for (const [language, aliases] of Object.entries({
  EN: ["eng", "english"],
  HI: ["hin", "hindi"],
  IT: ["ita", "italian", "italiano"],
  ES: ["spa", "esp", "spanish", "espanol", "castellano"],
  FR: ["fre", "french", "truefrench"],
  DE: ["ger", "deu", "german", "deutsch"],
  PT: ["portuguese", "portugues"],
  PL: ["pol", "polish"],
  CS: ["cze", "czech"],
  LA: ["latino"],
  JA: ["jpn", "japanese"],
  KO: ["kor", "korean"],
  ZH: ["chinese"],
  HE: ["heb", "hebrew"]
})) {
  for (const alias of aliases) {
    assert.equal(languageFor(` ${alias.toUpperCase()} `), language, alias);
    assert.deepEqual(languagesFromText([], `Film.${alias.toUpperCase()}.1080p`), [language], alias);
    assert.deepEqual(languagesFromText([], `Film.x${alias}x.1080p`), [], alias);
  }
}
assert.deepEqual(languagesFromText(["ita"], "Film.TRUEFRENCH.HEBREW"), ["IT"]);
assert.deepEqual(languagesFromText(["unrecognized"], "Film.HEBREW"), ["HE"]);
assert.deepEqual(languagesFromText([], "Film.ITALIAN.TRUEFRENCH.HEBREW"), ["IT", "FR", "HE"]);
assert.deepEqual(languagesFromText([], "Film.por.chi.fra"), []);
assert.deepEqual(languagesFromText([], "Film.pt-br"), ["PT_BR"]);
assert.equal(languageEmoji("he"), "🇮🇱");
const { DEBRID_STREAM_LANGUAGES, normalizeDebridStreamPreferences } =
  await import("../js/data/local/debridSettingsStore.js");
assert(DEBRID_STREAM_LANGUAGES.some((language) => language.id === "HE"));
assert.deepEqual(
  normalizeDebridStreamPreferences({ requiredLanguages: ["HE"] }).requiredLanguages,
  ["HE"]
);

const subtitleMethods = createPlayerScreenMethods49();
const collect = subtitleMethods.collectSubtitleOptionItems;
const tracks = ["spn", "es", "esp", "spl", "hbs-srp", "sr", "hbs-hrv", "hbs-bos", "hbs"];
const player = {
  trackDialogCache: {},
  getSubtitleEntries: (tab) =>
    tab === "builtIn"
      ? tracks.map((language, i) => ({ id: `t${i}`, label: language, track: { language } }))
      : []
};
const options = collect.call(player);
assert.deepEqual(
  options.map((o) => o.languageKey),
  ["es", "es", "es", "es-419", "sr", "sr", "hr", "bs", "hbs"]
);
assert.equal(
  new Set(options.slice(0, 3).map((o) => o.languageLabel)).size,
  1,
  "Spanish aliases share a display label"
);
const addonPlayer = {
  trackDialogCache: {},
  getSubtitleOptionStableId: subtitleMethods.getSubtitleOptionStableId,
  getSubtitleEntries: (tab) =>
    tab === "addons"
      ? tracks.map((language, i) => ({
          id: `a${i}`,
          secondary: "Fixture",
          track: { id: `${language}-${i}`, language, url: `https://fixture.invalid/${i}` }
        }))
      : []
};
const addonOptions = collect.call(addonPlayer);
assert.deepEqual(
  addonOptions.map((o) => o.languageKey),
  options.map((o) => o.languageKey)
);
assert.equal(
  new Set(addonOptions.map((o) => o.id)).size,
  tracks.length,
  "grouping retains distinct subtitle files"
);
const startup = createPlayerScreenMethods52();
for (const [index, target] of [
  [0, "es"],
  [2, "es"],
  [3, "es-419"],
  [4, "sr"],
  [6, "hr"],
  [7, "bs"]
]) {
  assert.equal(startup.matchesStartupSubtitleTarget.call(startup, options[index], target), true);
}
assert.equal(
  options[3].languageKey === options[0].languageKey,
  false,
  "Latin American Spanish remains separate"
);
console.log(
  "Subtitle language parity passed: normalization, real option grouping, startup matching, charset, flags and unknown HBS"
);
