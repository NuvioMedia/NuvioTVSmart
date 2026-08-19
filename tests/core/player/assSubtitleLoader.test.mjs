import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import {
  loadAssSubtitleLib,
  resetAssSubtitleLibCache
} from "../../../js/core/player/assSubtitleLoader.js";
import { loadStreamingLibs, warmStreamingLibs } from "../../../js/runtime/loadStreamingLibs.js";

const requestLog = [];

function installDocument({ failSources = [], assStub = null } = {}) {
  globalThis.document = {
    createElement() {
      return {
        src: "",
        async: false,
        onload: null,
        onerror: null,
        remove() {}
      };
    },
    head: {
      appendChild(script) {
        requestLog.push(script.src);
        queueMicrotask(() => {
          if (failSources.some((src) => script.src.includes(src))) {
            script.onerror?.(new Error(`load failed: ${script.src}`));
          } else {
            if (assStub) {
              globalThis.ASS = assStub;
            }
            script.onload?.();
          }
        });
      }
    }
  };
  return globalThis.document;
}

function setAssGlobal(value) {
  if (value) {
    globalThis.ASS = value;
  } else {
    delete globalThis.ASS;
  }
}

beforeEach(() => {
  requestLog.length = 0;
  delete globalThis.document;
  setAssGlobal(null);
  resetAssSubtitleLibCache();
});

test("loads the local asset first and validates the global constructor", async () => {
  installDocument({ assStub: function ASS() {} });
  const Ass = await loadAssSubtitleLib();
  assert.equal(typeof Ass, "function");
  assert.deepEqual(requestLog, ["assets/libs/ass.min.js"]);
});

test("falls back to the CDN when the local asset fails", async () => {
  installDocument({ failSources: ["assets/libs/ass.min.js"], assStub: function ASS() {} });
  const Ass = await loadAssSubtitleLib();
  assert.equal(typeof Ass, "function");
  assert.equal(requestLog.length, 2);
  assert.match(requestLog[0], /assets\/libs\/ass\.min\.js$/);
  assert.match(requestLog[1], /cdn\.jsdelivr\.net\/npm\/assjs@0\.1\.10/);
});

test("rejects when the constructor never appears", async () => {
  installDocument();
  await assert.rejects(loadAssSubtitleLib(), /ass\.js/);
});

test("shares one in-flight promise across concurrent calls", async () => {
  installDocument({ assStub: function ASS() {} });
  const first = loadAssSubtitleLib();
  const second = loadAssSubtitleLib();
  assert.equal(first, second);
  await first;
  assert.equal(requestLog.length, 1);
});

test("retries after a failed load when called again", async () => {
  installDocument({ failSources: ["assets/libs/ass.min.js", "cdn.jsdelivr.net"] });
  await assert.rejects(loadAssSubtitleLib());
  installDocument({ assStub: function ASS() {} });
  const Ass = await loadAssSubtitleLib();
  assert.equal(typeof Ass, "function");
});

test("resolves immediately when the global is already present", async () => {
  installDocument();
  const Ctor = function ASS() {};
  setAssGlobal(Ctor);
  assert.equal(await loadAssSubtitleLib(), Ctor);
  assert.equal(requestLog.length, 0);
});

test("rejects a truthy non-function ASS global and loads the script anyway", async () => {
  installDocument({ assStub: function ASS() {} });
  globalThis.ASS = { notAConstructor: true };
  const Ass = await loadAssSubtitleLib();
  assert.equal(typeof Ass, "function");
  assert.deepEqual(requestLog, ["assets/libs/ass.min.js"]);
});

test("loadStreamingLibs never requests ass.js", async () => {
  installDocument({ failSources: ["hls.min.js", "dash.all.min.js"] });
  globalThis.Hls = function Hls() {};
  globalThis.dashjs = { dashjs: {} };
  try {
    await loadStreamingLibs();
  } finally {
    delete globalThis.Hls;
    delete globalThis.dashjs;
  }
  assert.equal(requestLog.filter((src) => src.includes("ass")).length, 0);
});

test("warmStreamingLibs never requests ass.js", async () => {
  installDocument({ failSources: ["hls.min.js", "dash.all.min.js"] });
  globalThis.Hls = function Hls() {};
  globalThis.dashjs = { dashjs: {} };
  try {
    warmStreamingLibs({ delayMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 80));
  } finally {
    delete globalThis.Hls;
    delete globalThis.dashjs;
  }
  assert.equal(requestLog.filter((src) => src.includes("ass")).length, 0);
});
