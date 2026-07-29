import assert from "node:assert/strict";
import test from "node:test";

import { PlayerController } from "../../../core/player/playerController.js";
import { Router } from "../../navigation/router.js";

const PlayerScreen = Router.routes.player;

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

test("a stale HTML subtitle response cannot replace the latest selection", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const responseText = deferred();
  globalThis.fetch = async () => ({
    ok: true,
    text: () => responseText.promise
  });

  const player = Object.create(PlayerScreen);
  Object.assign(player, {
    subtitleSelectionToken: 1,
    resolveSubtitlePlaybackUrl: async () => "blob:subtitle",
    clearMountedExternalSubtitleTracks() {
      assert.fail("stale selection cleared the active track");
    },
    clearHtmlSubtitleOverlay() {
      assert.fail("stale selection cleared the active overlay");
    }
  });

  const applying = player.applyTvHtmlAddonSubtitle({ id: "old", url: "old.srt" }, 0, 1);
  player.subtitleSelectionToken = 2;
  responseText.resolve("1\n00:00:01,000 --> 00:00:02,000\nOld subtitle");

  assert.equal(await applying, false);
});

test("a stale fallback subtitle load cannot mount a track", async (context) => {
  const originalVideo = PlayerController.video;
  const originalIsUsingAvPlay = PlayerController.isUsingAvPlay;
  const originalDocument = globalThis.document;
  context.after(() => {
    PlayerController.video = originalVideo;
    PlayerController.isUsingAvPlay = originalIsUsingAvPlay;
    globalThis.document = originalDocument;
  });

  PlayerController.video = {};
  PlayerController.isUsingAvPlay = () => false;
  globalThis.document = {
    createElement() {
      assert.fail("stale selection mounted a track");
    }
  };

  const resolvedUrl = deferred();
  const player = Object.create(PlayerScreen);
  Object.assign(player, {
    subtitles: [{ id: "old", url: "old.srt" }],
    subtitleSelectionToken: 1,
    externalTrackNodes: [],
    getTextTracks: () => [],
    disableEmbeddedSubtitleSelection() {},
    clearMountedExternalSubtitleTracks() {},
    resolveSubtitlePlaybackUrl: () => resolvedUrl.promise
  });

  const applying = player.applyFallbackAddonSubtitle(0, 1);
  player.subtitleSelectionToken = 2;
  resolvedUrl.resolve("blob:subtitle");

  await applying;
});
