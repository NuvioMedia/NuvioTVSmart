import test from "node:test";
import assert from "node:assert/strict";
import { ProfanityMuteController, createProfanityMuteDriver } from "./profanityMuteController.js";

function fakeDriver() {
  const calls = [];
  return { calls, setMuted: (muted) => (calls.push(muted), true) };
}

test("mutes inside ranges and unmutes when leaving them", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let time = 0;
  const driver = fakeDriver();
  const changes = [];
  const controller = new ProfanityMuteController({
    driver,
    getSubtitleTime: () => time,
    onMuteChange: (muted) => changes.push(muted)
  });
  controller.setRanges([{ start: 1, end: 2 }]);
  assert.deepEqual(changes, []);
  time = 1.2;
  controller.sync();
  assert.deepEqual(changes, [true]);
  time = 2.5;
  controller.sync();
  assert.deepEqual(changes, [true, false]);
  controller.destroy();
});

test("pausing or disabling always restores audio", () => {
  let playing = true;
  const driver = fakeDriver();
  const controller = new ProfanityMuteController({
    driver,
    getSubtitleTime: () => 1.5,
    isPlaying: () => playing
  });
  controller.setRanges([{ start: 1, end: 2 }]);
  assert.equal(controller.muted, true);
  playing = false;
  controller.sync();
  assert.equal(controller.muted, false);
  playing = true;
  controller.sync();
  assert.equal(controller.muted, true);
  controller.setEnabled(false);
  assert.equal(controller.muted, false);
  controller.destroy();
});

test("live windows mute for their duration", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const driver = fakeDriver();
  const controller = new ProfanityMuteController({ driver, getSubtitleTime: () => 0 });
  controller.muteLive([{ startMs: 200, endMs: 700 }]);
  assert.equal(controller.muted, false);
  t.mock.timers.tick(250);
  assert.equal(controller.muted, true);
  t.mock.timers.tick(600);
  assert.equal(controller.muted, false);
  controller.destroy();
});

test("video driver restores the previous volume and never fights a user mute on TV audio", () => {
  const video = { volume: 0.6 };
  const htmlDriver = createProfanityMuteDriver({ getVideo: () => video });
  assert.equal(htmlDriver.setMuted(true), true);
  assert.equal(video.volume, 0);
  htmlDriver.setMuted(false);
  assert.equal(video.volume, 0.6);

  let systemMuted = true;
  globalThis.tizen = {
    tvaudiocontrol: { isMute: () => systemMuted, setMute: (value) => (systemMuted = value) }
  };
  const tvDriver = createProfanityMuteDriver({ isUsingAvPlay: () => true });
  assert.equal(tvDriver.setMuted(true), false, "already muted by the user");
  systemMuted = false;
  assert.equal(tvDriver.setMuted(true), true);
  assert.equal(systemMuted, true);
  tvDriver.setMuted(false);
  assert.equal(systemMuted, false);
  delete globalThis.tizen;
});

function fakeTv({ muteWorks = true, muteThrows = false, volume = 20 } = {}) {
  const tv = {
    muted: false,
    volume,
    isMute: () => tv.muted,
    setMute: (value) => {
      if (muteThrows) throw Object.assign(new Error("denied"), { name: "SecurityError" });
      if (muteWorks) tv.muted = value;
    },
    getVolume: () => tv.volume,
    setVolume: (value) => {
      tv.volume = value;
    }
  };
  globalThis.tizen = { tvaudiocontrol: tv };
  return tv;
}

test("TV mute that silently does nothing falls back to volume 0 and restores it", () => {
  const tv = fakeTv({ muteWorks: false, volume: 23 });
  const driver = createProfanityMuteDriver({ isUsingAvPlay: () => true });
  assert.equal(driver.setMuted(true), true);
  assert.equal(tv.volume, 0);
  assert.equal(tv.muted, false);
  driver.setMuted(false);
  assert.equal(tv.volume, 23);
  delete globalThis.tizen;
});

test("a refused TV mute falls back to volume, and total failure is explained", () => {
  const tv = fakeTv({ muteThrows: true, volume: 15 });
  const driver = createProfanityMuteDriver({ isUsingAvPlay: () => true });
  assert.equal(driver.setMuted(true), true);
  assert.equal(tv.volume, 0);
  driver.setMuted(false);
  assert.equal(tv.volume, 15);

  tv.setVolume = () => {
    throw Object.assign(new Error("denied"), { name: "SecurityError" });
  };
  assert.equal(driver.setMuted(true), false);
  assert.match(driver.getLastError(), /setMute: SecurityError; setVolume: SecurityError/);
  delete globalThis.tizen;
});

test("failed mutes are reported to the player", () => {
  delete globalThis.tizen;
  const failures = [];
  const controller = new ProfanityMuteController({
    driver: createProfanityMuteDriver({ isUsingAvPlay: () => true }),
    getSubtitleTime: () => 1.5,
    onMuteFailed: (reason) => failures.push(reason)
  });
  controller.setRanges([{ start: 1, end: 2 }]);
  assert.equal(controller.muted, false);
  assert.deepEqual(failures, ["TV audio control is not available"]);
  controller.destroy();
});

test("HTML5 playback through the audio boost also silences the gain node", () => {
  const video = { volume: 1 };
  const gainNode = { gain: { value: 1.8 } };
  const driver = createProfanityMuteDriver({
    getVideo: () => video,
    getGainNode: () => gainNode,
    getGainValue: () => 1.8
  });
  driver.setMuted(true);
  assert.equal(gainNode.gain.value, 0);
  assert.equal(video.volume, 0);
  driver.setMuted(false);
  assert.equal(gainNode.gain.value, 1.8);
  assert.equal(video.volume, 1);
});
