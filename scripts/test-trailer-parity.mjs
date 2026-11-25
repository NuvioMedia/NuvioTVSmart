import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyTrailerCaptionParams,
  trailerCaptionOptions
} from "../js/core/detail/trailerCaptions.js";

const params = new URLSearchParams();
applyTrailerCaptionParams(params, {});
assert.equal(params.get("cc_load_policy"), "0");
assert.equal(params.get("cc_lang_pref"), null);

applyTrailerCaptionParams(params, { captionsEnabled: true, captionsLanguage: "pt-BR" });
assert.equal(params.get("cc_load_policy"), "1");
assert.equal(params.get("cc_lang_pref"), "pt-BR");

// "none"/"off" and UI labels must not reach the YouTube player.
applyTrailerCaptionParams(params, { captionsEnabled: true, captionsLanguage: "off" });
assert.equal(params.get("cc_load_policy"), "1");
assert.equal(params.get("cc_lang_pref"), null);

assert.deepEqual(
  trailerCaptionOptions({ trailerSubtitles: true, subtitleStyle: { preferredLanguage: "it" } }),
  {
    captionsEnabled: true,
    captionsLanguage: "it"
  }
);
assert.deepEqual(trailerCaptionOptions({}), { captionsEnabled: false, captionsLanguage: "" });

const proxy = readFileSync(new URL("../docs/youtube-proxy.html", import.meta.url), "utf8");
assert.match(
  proxy,
  /cc_lang_pref: captionsLanguage/,
  "the proxy must forward the preferred caption language"
);

const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, v),
  removeItem: (k) => storage.delete(k)
};
const { LayoutPreferences: layout } = await import("../js/data/local/layoutPreferences.js");

assert.equal(layout.getForProfile("1").focusedPosterBackdropTrailerPlaybackTarget, "hero_media");
assert.equal(layout.getForProfile("1").focusedPosterTrailerContinueInDetails, false);

layout.setForProfile(
  "1",
  { focusedPosterBackdropTrailerPlaybackTarget: "hero_media_no_expand" },
  { silentSync: true }
);
assert.equal(
  layout.getForProfile("1").focusedPosterBackdropTrailerPlaybackTarget,
  "hero_media_no_expand"
);

layout.setForProfile(
  "1",
  { focusedPosterBackdropTrailerPlaybackTarget: "HERO_MEDIA_NO_EXPAND" },
  { silentSync: true }
);
assert.equal(
  layout.getForProfile("1").focusedPosterBackdropTrailerPlaybackTarget,
  "hero_media_no_expand"
);

layout.setForProfile(
  "1",
  { focusedPosterBackdropTrailerPlaybackTarget: "unknown" },
  { silentSync: true }
);
assert.equal(layout.getForProfile("1").focusedPosterBackdropTrailerPlaybackTarget, "hero_media");

layout.setForProfile("1", { focusedPosterTrailerContinueInDetails: true }, { silentSync: true });
assert.equal(layout.getForProfile("1").focusedPosterTrailerContinueInDetails, true);

const sync = readFileSync(
  new URL(
    "../js/core/profile/profileSettingsSyncServiceHelpers-02-normalize-half-step-for-sync.js",
    import.meta.url
  ),
  "utf8"
);
assert.match(sync, /HERO_MEDIA_NO_EXPAND/, "Android sync must keep the third trailer location");
console.log("test-trailer-parity: ok");
