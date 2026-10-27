import assert from "node:assert/strict";
import test from "node:test";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { Platform } = await import("../js/platform/index.js");
const { PlayerController } = await import("../js/core/player/playerController.js");
const { createPlayerControllerMethods03 } =
  await import("../js/core/player/playerControllerMethods-03-start-av-play-tick-timer.js");
const { createPlayerScreenMethods30 } =
  await import("../js/ui/screens/player/playerScreenMethods-30-schedule-buffering-spinner-refresh.js");
const { createPlayerVideoEventHandlers } =
  await import("../js/ui/screens/player/playerVideoEventHandlers.js");
const { createWebOsDtsAudioMethods } =
  await import("../js/platform/webos/webosDtsAudioTranscoder.js");
Platform.isWebOS = () => true;

for (const automaticFallback of [false, true]) {
  test(`failed startup selection settles the gate (automatic fallback: ${automaticFallback})`, () => {
    const pending = {
      selectionKind: "embedded",
      selectedTrackIndex: 1,
      automaticFallback,
      entryId: "english"
    };
    const screen = {
      ...createPlayerScreenMethods30(),
      startupAudioGateActive: true,
      startupAudioPreferenceApplied: false,
      pendingWebOsAudioSelection: pending,
      clearStartupAudioPreferenceRetry() {},
      invalidateTrackDialogCaches() {},
      renderControlButtons() {},
      renderAudioDialog() {},
      scheduleLoadingCompletionCheck() {}
    };
    PlayerController.getPlaybackReadyState = () => 4;
    const handlers = createPlayerVideoEventHandlers.call(screen, {}, () => false);
    handlers.onWebOsAudioTrackSelectionChanged({ detail: { ...pending, status: "failed" } });
    assert.equal(screen.pendingWebOsAudioSelection, null);
    assert.equal(screen.startupAudioPreferenceApplied, true);
    assert.equal(screen.isStartupGateReleaseReady(), true);
    assert.equal(
      screen.failedAutomaticAudioFallbackEntryId,
      automaticFallback ? "english" : undefined
    );
  });
}

test("manual playback failure does not change settled startup preferences", () => {
  const pending = { selectionKind: "embedded", selectedTrackIndex: 1 };
  const screen = {
    startupAudioGateActive: false,
    startupAudioPreferenceApplied: false,
    pendingWebOsAudioSelection: pending,
    invalidateTrackDialogCaches() {},
    renderControlButtons() {},
    renderAudioDialog() {}
  };
  createPlayerVideoEventHandlers
    .call(screen, {}, () => false)
    .onWebOsAudioTrackSelectionChanged({ detail: { ...pending, status: "failed" } });
  assert.equal(screen.startupAudioPreferenceApplied, false);
});

for (const { gated, muted, releaseDuringReload } of [
  { gated: true, muted: true, releaseDuringReload: false },
  { gated: true, muted: true, releaseDuringReload: true },
  { gated: false, muted: true, releaseDuringReload: false },
  { gated: false, muted: false, releaseDuringReload: false }
]) {
  test(`native reload restores mute (gate: ${gated}, muted: ${muted}, release: ${releaseDuringReload})`, async () => {
    const video = Object.assign(new EventTarget(), {
      muted,
      readyState: 4,
      currentTime: 1,
      duration: 100,
      play: () => Promise.resolve(),
      pause() {}
    });
    const controller = {
      ...createPlayerControllerMethods03(),
      ...createWebOsDtsAudioMethods(),
      video,
      startupAudioGateActive: gated,
      startupPresentationAudioMuted: gated,
      isPlaying: true,
      isUsingNativePlayback: () => true,
      isUsingAvPlay: () => false,
      currentPlaybackUrl: "http://example.test/original.mkv",
      webOsDtsAudioState: { id: "old-conversion" },
      webOsDtsAudioFailures: new Set(),
      emitVideoEvent() {},
      resetNativeMediaState() {},
      resume() {},
      applyNativeSource() {
        if (releaseDuringReload) {
          this.setStartupAudioGate(false, { resume: false });
          this.setStartupPresentationAudioMuted(false);
        }
        queueMicrotask(() => video.dispatchEvent(new Event("loadedmetadata")));
      },
      requestConfirmedWebOsAudioTrackSelection() {
        return true;
      }
    };
    controller.setWebOsAudioTrackWithDtsConversion({}, 0, 0, "embedded", false);
    await new Promise((resolve) => setImmediate(resolve));
    const expectedMuted = releaseDuringReload ? false : muted;
    assert.equal(video.muted, expectedMuted);
    assert.equal(controller.webOsDtsAudioState.originalMuted, expectedMuted);
    controller.stopWebOsDtsAudioTranscode();
  });
}

const { createPlayerScreenMethods31 } =
  await import("../js/ui/screens/player/playerScreenMethods-31-seek-playback-seconds.js");

for (const blockedBy of [null, "gate", "frame", "advance", "restore", "error", "external"]) {
  test(`hidden loading overlay releases presentation mute only after startup is ready (${blockedBy})`, () => {
    const video = { muted: true, defaultMuted: true, volume: 1 };
    Object.assign(PlayerController, {
      video,
      startupAudioGateActive: blockedBy === "gate",
      startupPresentationAudioMuted: true,
      webOsDtsAudioState: { originalMuted: true }
    });
    const screen = {
      ...createPlayerScreenMethods30(),
      ...createPlayerScreenMethods31(),
      loadingVisible: false,
      hasPresentedPlaybackFrame: blockedBy !== "frame",
      startupPlaybackHasAdvanced: blockedBy !== "advance",
      startupAudioGateActive: blockedBy === "gate",
      pendingPlaybackRestore: blockedBy === "restore" ? {} : null,
      uiRefs: { loadingOverlay: { classList: { add() {}, remove() {}, toggle() {} } } },
      isStartupLoadingVisible: () => false,
      isBufferingSpinnerVisible: () => false,
      isStartupErrorVisible: () => blockedBy === "error",
      isExternalFrameMode: () => blockedBy === "external",
      isBufferingForPauseOverlay: () => false,
      isStartupGateReleaseReady: () => false,
      clearBufferingSpinnerTimer() {},
      renderSkipIntroButton() {},
      renderNextEpisodeCard() {}
    };
    screen.updateLoadingVisibility();
    assert.equal(PlayerController.startupPresentationAudioMuted, blockedBy !== null);
    assert.equal(video.muted, blockedBy !== null);
    assert.equal(PlayerController.webOsDtsAudioState.originalMuted, blockedBy !== null);
  });
}
