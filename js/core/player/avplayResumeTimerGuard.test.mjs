import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const stripModule = (source) =>
  source
    .replace(/^import [\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^import\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^export /gm, "");

async function loadResumeFixture() {
  const src19 = stripModule(
    await readFile(new URL("./playerControllerMethods-19-pause.js", import.meta.url), "utf8")
  );

  const scheduled = [];
  const context = vm.createContext({
    setTimeout: (fn, ms) => {
      scheduled.push({ fn, ms });
      return scheduled.length;
    },
    clearTimeout() {},
    internals: new Proxy(
      {},
      {
        get(target, prop) {
          return prop in target ? target[prop] : () => {};
        }
      }
    )
  });
  context.globalThis = context;
  vm.runInContext(`${src19}\nglobalThis.api = createPlayerControllerMethods19();`, context);

  const counts = { rateApplies: 0, audioApplies: 0, subtitleApplies: 0 };
  const ctrl = Object.assign(Object.create(context.api), {
    video: {},
    playRequestToken: 10,
    isPlaying: false,
    isUsingAvPlay: () => true,
    getAvPlay: () => ({ play() {} }),
    cancelProgressSyncAfterSeek() {},
    flushCurrentProgress() {},
    syncWebOsPlaybackKeepAwake() {},
    reapplyAvPlayPlaybackRate() {
      counts.rateApplies += 1;
    },
    startAvPlayTickTimer() {},
    emitVideoEvent() {},
    applyPendingAvPlayAudioTrackSelection() {
      counts.audioApplies += 1;
    },
    applyPendingAvPlaySubtitleTrackSelection() {
      counts.subtitleApplies += 1;
    }
  });

  return { ctrl, scheduled, counts };
}

test("playerControllerMethods-19 applies rate and pending tracks on active deferred resume timers", async () => {
  const { ctrl, scheduled, counts } = await loadResumeFixture();

  ctrl.resume();
  assert.equal(ctrl.isPlaying, true);
  assert.equal(counts.rateApplies, 1);
  assert.equal(counts.audioApplies, 0);
  assert.equal(counts.subtitleApplies, 0);
  assert.deepEqual(
    scheduled.map((entry) => entry.ms),
    [0, 300]
  );

  scheduled.forEach((entry) => entry.fn());
  assert.equal(counts.rateApplies, 3);
  assert.equal(counts.audioApplies, 2);
  assert.equal(counts.subtitleApplies, 2);
});

test("playerControllerMethods-19 guards deferred AVPlay resume timers against stale tokens and pause state", async () => {
  // Advancing playRequestToken before deferred timers fire: timers must no-op.
  const staleToken = await loadResumeFixture();
  staleToken.ctrl.resume();
  assert.equal(staleToken.counts.rateApplies, 1);
  assert.equal(staleToken.scheduled.length, 2);

  staleToken.ctrl.playRequestToken = 11;
  staleToken.scheduled.forEach((entry) => entry.fn());
  assert.equal(staleToken.counts.rateApplies, 1);
  assert.equal(staleToken.counts.audioApplies, 0);
  assert.equal(staleToken.counts.subtitleApplies, 0);

  // Setting isPlaying = false before deferred timers fire: timers must no-op.
  const paused = await loadResumeFixture();
  paused.ctrl.resume();
  assert.equal(paused.counts.rateApplies, 1);
  assert.equal(paused.scheduled.length, 2);

  paused.ctrl.isPlaying = false;
  paused.scheduled.forEach((entry) => entry.fn());
  assert.equal(paused.counts.rateApplies, 1);
  assert.equal(paused.counts.audioApplies, 0);
  assert.equal(paused.counts.subtitleApplies, 0);
});
