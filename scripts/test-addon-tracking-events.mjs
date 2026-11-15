import test from "node:test";
import assert from "node:assert/strict";

const delivered = [];
globalThis.fetch = async (url) => {
  delivered.push(url);
  return { ok: true };
};

const {
  ADDON_LIBRARY_RESOURCE,
  ADDON_PLAYER_RESOURCE,
  AddonEventDispatcher,
  AddonLibraryAction,
  buildAddonEventUrl,
  isTrackingAddon,
  libraryVideoIdChunks
} = await import("../js/data/repository/addonEventDispatcher.js");

test("the event URL encodes ids and extras and keeps the base query", () => {
  assert.equal(
    buildAddonEventUrl(
      "https://addon.example/token?lang=pl",
      ADDON_LIBRARY_RESOURCE,
      "series",
      "tt0898266",
      [
        ["action", "watched"],
        ["videoId", "tt0898266:1:1,tt0898266:1:2"]
      ]
    ),
    "https://addon.example/token/library/series/tt0898266/action=watched&videoId=tt0898266%3A1%3A1%2Ctt0898266%3A1%3A2.json?lang=pl"
  );
  assert.equal(
    buildAddonEventUrl("https://addon.example/", ADDON_PLAYER_RESOURCE, "series", "kitsu:48239:1", [
      ["action", "start"],
      ["currentTime", "0"],
      ["duration", "1465319"]
    ]),
    "https://addon.example/player/series/kitsu%3A48239%3A1/action=start&currentTime=0&duration=1465319.json"
  );
});

test("video ids are deduplicated and chunked by 100", () => {
  const ids = [
    ...Array.from({ length: 250 }, (_, index) => `tt1:1:${index + 1}`),
    "tt1:1:1",
    "",
    " "
  ];
  const chunks = libraryVideoIdChunks(ids);
  assert.deepEqual(
    chunks.map((chunk) => chunk.length),
    [100, 100, 50]
  );
  assert.equal(chunks[0][0], "tt1:1:1");
  assert.equal(chunks[2][49], "tt1:1:250");
});

test("events go only to add-ons declaring the resource and matching the id", async () => {
  delivered.length = 0;
  const addons = [
    {
      baseUrl: "https://all.example",
      resources: [
        { name: "library", types: [] },
        { name: "player", types: [] }
      ]
    },
    {
      baseUrl: "https://tt-only.example",
      idPrefixes: ["tt"],
      resources: [{ name: "library", types: [] }]
    },
    { baseUrl: "https://player-only.example", resources: [{ name: "player", types: [] }] }
  ];
  AddonEventDispatcher.library(
    "series",
    "kitsu:48239",
    AddonLibraryAction.LIBRARY_ADD,
    () => addons
  );
  AddonEventDispatcher.library(
    "series",
    "server:conn:item",
    AddonLibraryAction.LIBRARY_ADD,
    () => addons
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(delivered, [
    "https://all.example/library/series/kitsu%3A48239/action=libraryAdd.json"
  ]);
  assert.equal(isTrackingAddon(addons[2]), true);
  assert.equal(isTrackingAddon({ resources: ["stream", "meta"] }), false);
});

test("player events: start once, pause only after start, one stop, stop on video change", async () => {
  const { AddonPlayerScrobbleService } =
    await import("../js/data/repository/addonEventDispatcher.js");
  const sent = [];
  const original = AddonEventDispatcher.player;
  AddonEventDispatcher.player = (target, action, positionMs) =>
    sent.push(`${target.videoId}:${action}:${positionMs}`);
  try {
    AddonPlayerScrobbleService.cancel();
    const episode1 = {
      contentType: "series",
      contentId: "tt1",
      videoId: "tt1:1:1",
      positionMs: 0,
      durationMs: 100
    };
    AddonPlayerScrobbleService.pause(episode1);
    AddonPlayerScrobbleService.start(episode1);
    AddonPlayerScrobbleService.start({ ...episode1, positionMs: 5 });
    AddonPlayerScrobbleService.pause({ ...episode1, positionMs: 10 });
    AddonPlayerScrobbleService.start({
      contentType: "series",
      contentId: "tt1",
      videoId: "tt1:1:2",
      positionMs: 0
    });
    AddonPlayerScrobbleService.stop({ positionMs: 30 });
    AddonPlayerScrobbleService.stop({ positionMs: 40 });
    assert.deepEqual(sent, [
      "tt1:1:1:start:0",
      "tt1:1:1:pause:10",
      "tt1:1:1:stop:0",
      "tt1:1:2:start:0",
      "tt1:1:2:stop:30"
    ]);
  } finally {
    AddonEventDispatcher.player = original;
  }
});
