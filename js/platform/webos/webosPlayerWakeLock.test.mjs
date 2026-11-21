import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const webosSource = (
  await readFile(new URL("./webosPlayerExtensions.js", import.meta.url), "utf8")
).replace(/^export /gm, "");

test("WebOSPlayerExtensions drops timeupdate, binds visibility once, avoids redundant blockScreenSaver calls, and releases stale wake locks", async () => {
  const docListeners = new Map();
  const blockCalls = [];
  const intervals = new Map();
  let nextIntervalId = 1;
  const wakeRequests = [];

  const context = vm.createContext({
    document: {
      addEventListener(eventName, fn) {
        if (!docListeners.has(eventName)) {
          docListeners.set(eventName, []);
        }
        docListeners.get(eventName).push(fn);
      }
    },
    webOSSystem: {
      setWindowProperty(name, value) {
        if (name === "blockScreenSaver") {
          blockCalls.push(value);
        }
      }
    },
    navigator: {
      wakeLock: {
        request(type) {
          assert.equal(type, "screen");
          let resolveLock;
          const promise = new Promise((resolve) => {
            resolveLock = resolve;
          });
          wakeRequests.push({ resolveLock });
          return promise;
        }
      }
    },
    setInterval: (fn, ms) => {
      const id = nextIntervalId++;
      intervals.set(id, { fn, ms });
      return id;
    },
    clearInterval: (id) => {
      intervals.delete(id);
    }
  });
  context.globalThis = context;
  vm.runInContext(
    `${webosSource}\nglobalThis.WebOSPlayerExtensions = WebOSPlayerExtensions;`,
    context
  );

  const makeVideo = () => {
    const listeners = new Map();
    return {
      paused: false,
      ended: false,
      readyState: 4,
      listeners,
      setAttribute() {},
      addEventListener(eventName, fn) {
        if (!listeners.has(eventName)) {
          listeners.set(eventName, []);
        }
        listeners.get(eventName).push(fn);
      },
      emit(eventName) {
        (listeners.get(eventName) || []).forEach((fn) => fn());
      }
    };
  };

  const video1 = makeVideo();
  const video2 = makeVideo();
  context.WebOSPlayerExtensions.apply(video1);
  context.WebOSPlayerExtensions.apply(video2);

  assert.equal(video1.listeners.has("timeupdate"), false, "must not attach timeupdate listener");
  assert.equal(video2.listeners.has("timeupdate"), false);
  assert.equal(
    (docListeners.get("visibilitychange") || []).length,
    1,
    "visibilitychange must be bound once globally across video instances"
  );
  assert.equal((docListeners.get("webkitvisibilitychange") || []).length, 1);

  video1.emit("play");
  const callsAfterFirstPlay = blockCalls.length;
  assert.equal(callsAfterFirstPlay > 0, true);
  assert.equal(wakeRequests.length, 1);

  context.WebOSPlayerExtensions.startPlaybackKeepAwake(() => true);
  video1.emit("playing");
  video1.emit("seeked");
  assert.equal(
    blockCalls.length,
    callsAfterFirstPlay,
    "repeated events while already blocked must not spam setWindowProperty"
  );
  assert.equal(wakeRequests.length, 1, "pending wakeLock request must deduplicate repeat calls");

  context.WebOSPlayerExtensions.refreshPlaybackKeepAwake();
  assert.equal(blockCalls.length > callsAfterFirstPlay, true);

  let released = 0;
  video1.paused = true;
  video1.emit("pause");
  context.WebOSPlayerExtensions.stopPlaybackKeepAwake();
  assert.equal(intervals.size, 0, "refresh interval must be cleared when inactive");

  wakeRequests[0].resolveLock({
    addEventListener() {},
    release() {
      released += 1;
      return Promise.resolve();
    }
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(released, 1, "stale wakeLock resolution after stop must immediately release");
});
