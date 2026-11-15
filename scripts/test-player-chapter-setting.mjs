import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Android "Show Chapters" / "Show Chapter Title": chapters reach the marks,
// title, button and panel only when shown; skip intro keeps its own copy.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadMethods(settings) {
  const source = readFileSync(
    path.join(ROOT, "js/ui/screens/player/playerScreenMethods-76-chapters-panel.js"),
    "utf8"
  )
    .replace(/^import \* as internals from .*$/m, "")
    .replace(/^export function/m, "function");
  const sandbox = {
    internals: {
      escapeHtml: String,
      contentTextDirection: () => "ltr",
      t: (_key, params, fallback) => fallback,
      clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
      isSelectKeyCode: () => false,
      isBackEvent: () => false,
      PlayerSettingsStore: { get: () => settings }
    },
    Number,
    String,
    Array,
    Math,
    Set
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${source}; globalThis.__factory = createPlayerScreenMethods76;`, sandbox);
  return sandbox.__factory();
}

function fakeNode() {
  const classes = new Set(["hidden"]);
  return {
    innerHTML: "",
    textContent: "",
    attrs: {},
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    classList: {
      toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
      has: (name) => classes.has(name)
    },
    hidden: () => classes.has("hidden")
  };
}

function screenWith(settings) {
  const refs = {
    progressChapterMarks: fakeNode(),
    seekChapterMarks: fakeNode(),
    chapterTitle: fakeNode(),
    seekChapterTitle: fakeNode()
  };
  const screen = {
    ...loadMethods(settings),
    uiRefs: refs,
    getPlaybackDisplayDurationSeconds: () => 100,
    isLivePlayback: () => false
  };
  return { screen, refs };
}

const chapters = [
  { startMs: 0, title: "Opening" },
  { startMs: 25000, title: "" },
  { startMs: 50000, title: "End Credits" }
];

test("chapters stay hidden while Show Chapters is off", () => {
  const { screen, refs } = screenWith({ chaptersEnabled: false, chapterTitleEnabled: true });
  assert.equal(screen.applyPlayerChapters(chapters), false);
  assert.equal(screen.playerChapters.length, 0);
  screen.syncPlayerChapterTitle(30);
  assert.equal(refs.progressChapterMarks.innerHTML, "");
  assert.equal(refs.chapterTitle.hidden(), true);
});

test("Show Chapters marks each chapter start after 0 on both bars", () => {
  const { screen, refs } = screenWith({ chaptersEnabled: true, chapterTitleEnabled: true });
  assert.equal(screen.applyPlayerChapters(chapters), true);
  const marks = refs.progressChapterMarks.innerHTML.match(/left:[\d.]+%/g);
  assert.deepEqual(marks, ["left:25%", "left:50%"]);
  assert.equal(refs.seekChapterMarks.innerHTML, refs.progressChapterMarks.innerHTML);
});

test("the chapter title follows the position and falls back to the chapter number", () => {
  const { screen, refs } = screenWith({ chaptersEnabled: true, chapterTitleEnabled: true });
  screen.applyPlayerChapters(chapters);
  screen.syncPlayerChapterTitle(10);
  assert.equal(refs.chapterTitle.textContent, "Opening");
  screen.syncPlayerChapterTitle(30);
  assert.equal(refs.chapterTitle.textContent, "Chapter 2");
  assert.equal(refs.seekChapterTitle.textContent, "Chapter 2");
  assert.equal(refs.chapterTitle.hidden(), false);
});

test("Show Chapter Title off keeps the marks but hides the title", () => {
  const { screen, refs } = screenWith({ chaptersEnabled: true, chapterTitleEnabled: false });
  screen.applyPlayerChapters(chapters);
  screen.syncPlayerChapterTitle(30);
  assert.notEqual(refs.progressChapterMarks.innerHTML, "");
  assert.equal(refs.chapterTitle.hidden(), true);
});
