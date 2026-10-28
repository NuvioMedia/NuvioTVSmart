import assert from "node:assert/strict";
import test from "node:test";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { Platform } = await import("../js/platform/index.js");
const { WebOsLunaService } = await import("../js/platform/webos/webosLunaService.js");
const { createWebOsDtsAudioMethods } =
  await import("../js/platform/webos/webosDtsAudioTranscoder.js");
const { createPlayerControllerMethods02 } =
  await import("../js/core/player/playerControllerMethods-02-is-likely-direct-file-url.js");
const { createPlayerControllerMethods05 } =
  await import("../js/core/player/playerControllerMethods-05-get-av-play-subtitle-diagnostic-snapshot.js");
Platform.isWebOS = () => true;
globalThis.Worker = class {};
WebOsLunaService.isAvailable = () => true;
WebOsLunaService.request = async (_service, { method }) => {
  if (method === "ping") return { url: "http://127.0.0.1:1234" };
  if (method === "audioTranscodeCreate")
    return { id: "conversion", path: "/audio-transcode/conversion" };
  return { returnValue: true };
};

for (const languages of [["hu", "en", "de"], ["en", "en", "en"], ["en"]]) {
  test(`Luna, HTML and reapply retain the same native selection (${languages.join(",")})`, async () => {
    const tracks = languages.map((language, index) => ({
      id: String(index + 1),
      language,
      enabled: index === 0
    }));
    const sourceIndex = tracks.length === 1 ? 1 : 2;
    const nativeIndex = tracks.length === 1 ? 0 : 1;
    const commands = [];
    const controller = {
      ...createPlayerControllerMethods02(),
      ...createPlayerControllerMethods05(),
      ...createWebOsDtsAudioMethods(),
      video: Object.assign(new EventTarget(), {
        mediaId: "converted-media",
        currentTime: 0,
        paused: false,
        muted: false,
        textTracks: [],
        readyState: 4,
        play: () => Promise.resolve(),
        pause() {}
      }),
      currentPlaybackUrl: "http://example.test/source.mkv",
      nativeAudioTrackListToArray: () => tracks,
      isUsingNativePlayback: () => true,
      emitVideoEvent() {},
      resetNativeMediaState() {},
      applyNativeSource() {
        queueMicrotask(() => this.video.dispatchEvent(new Event("loadedmetadata")));
      },
      requestWebOsMediaCommand(method, parameters) {
        commands.push(parameters.index);
        return Promise.resolve({ returnValue: true });
      }
    };
    controller.setWebOsAudioTrackWithDtsConversion({}, sourceIndex, sourceIndex, "embedded", true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(controller.selectedWebOsEmbeddedAudioTrackIndex, sourceIndex);
    assert.equal(controller.selectedWebOsAudioTrackIndex, nativeIndex);
    assert.equal(
      tracks.findIndex((track) => track.enabled),
      nativeIndex
    );
    assert.equal(controller.reapplyWebOsNativeTrackSelections(), true);
    assert.deepEqual(commands, [nativeIndex, nativeIndex]);
    assert.equal(
      tracks.findIndex((track) => track.enabled),
      nativeIndex
    );
    assert.equal(controller.reapplyWebOsNativeTrackSelections(), false);
    controller.stopWebOsDtsAudioTranscode();
  });
}
