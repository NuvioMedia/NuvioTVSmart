import assert from "node:assert/strict";
import test from "node:test";
import { matchStreamBadges } from "./streamBadgeRules.js";

function rulesFor(pattern, name) {
  return {
    imports: [
      {
        sourceUrl: "https://example.com/badges.json",
        isActive: true,
        filters: [{ name, pattern, isEnabled: true }]
      }
    ]
  };
}

const hdrStream = {
  name: "Movie",
  streamPresentation: {
    resolution: "P2160",
    visualTags: ["HDR"]
  }
};

test("negative badge lookaheads inspect the full stream context", () => {
  const badges = matchStreamBadges(
    hdrStream,
    rulesFor("^(?!.*(HDR|DV|HLG)).*$", "SDR")
  );

  assert.deepEqual(badges, []);
});

test("positive anchored badge rules still match individual metadata fields", () => {
  const badges = matchStreamBadges(hdrStream, rulesFor("^P2160$", "4K"));

  assert.deepEqual(badges.map((badge) => badge.name), ["4K"]);
});
