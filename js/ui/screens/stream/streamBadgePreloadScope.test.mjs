import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");
const badgePreloadCall = /preload(?:Stream|MatchedStream)BadgeImages|preloadAddonLogoUrls/;

// Stream badge images only render in the Streams flow. Android TV loads them
// there on demand, so Home startup must not fetch or decode them.
test("Home startup does not preload stream badge images", async () => {
  const appSource = await read("../../../app.js");
  assert.equal(badgePreloadCall.test(appSource), false);
  assert.equal(appSource.includes('from "./ui/screens/stream/streamScreen.js"'), false);
});

test("Detail mount does not preload stream badge images", async () => {
  const mountSource = await read("../detail/metaDetailsScreenMethods-02-mount.js");
  assert.equal(badgePreloadCall.test(mountSource), false);
});

test("Streams flow still warms matched badge images before rendering rows", async () => {
  const loadStreamsSource = await read("./streamScreenMethods-04-load-streams.js");
  assert.equal(loadStreamsSource.includes("preloadMatchedStreamBadgeImages(chunkStreams, badgeSettings)"), true);
  assert.equal(loadStreamsSource.includes("preloadMatchedStreamBadgeImages(missingStreams, badgeSettings)"), true);
});
