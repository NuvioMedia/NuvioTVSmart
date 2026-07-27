import assert from "node:assert/strict";
import test from "node:test";
import { hasReleaseToken } from "./releaseToken.js";

test("release tokens do not match title substrings", () => {
  assert.equal(hasReleaseToken("Camp Rock 2008 1080p WEB-DL", "cam"), false);
  assert.equal(hasReleaseToken("The Lights 2019 2160p WEB-DL", "ts"), false);
  assert.equal(hasReleaseToken("Arts and Crafts 2020 1080p WEBRip", "ts"), false);
  assert.equal(hasReleaseToken("Movie 2020 1080p HDRip", "hdr"), false);
});

test("release tokens still match explicit quality and visual tags", () => {
  assert.equal(hasReleaseToken("Movie.2020.1080p.CAM.x264", "cam"), true);
  assert.equal(hasReleaseToken("Movie.2020.1080p.TS.x264", "ts"), true);
  assert.equal(hasReleaseToken("Movie.2020.2160p.HDR10+.x265", "hdr10"), true);
  assert.equal(hasReleaseToken("Movie.2020.2160p.HLG.x265", "hlg"), true);
});
