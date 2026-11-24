import test from "node:test";
import assert from "node:assert/strict";
import { isTalkShowGuestAppearance } from "../js/core/tmdb/talkShowCredits.js";

// Android TmdbMetadataServiceTest: skips talk show guest appearances but keeps hosted talk shows (51ebccc1c).
test("talk show guest spots are left out, hosted talk shows and other credits stay", () => {
  const tv = (character, genre_ids) => ({ media_type: "tv", character, genre_ids });
  assert.equal(isTalkShowGuestAppearance(tv("Self - Guest", [10767, 35])), true);
  assert.equal(isTalkShowGuestAppearance(tv("Self", [10767])), true);
  assert.equal(isTalkShowGuestAppearance(tv("", [10767])), true);
  assert.equal(isTalkShowGuestAppearance(tv("Self - Host", [10767])), false);
  assert.equal(isTalkShowGuestAppearance(tv("Co-Host", [10767])), false);
  assert.equal(isTalkShowGuestAppearance(tv("Hostess", [10767])), false);
  assert.equal(isTalkShowGuestAppearance(tv("Detective Ghost", [18, 80])), false);
  assert.equal(
    isTalkShowGuestAppearance({ media_type: "movie", character: "Self", genre_ids: [10767] }),
    false
  );
});
