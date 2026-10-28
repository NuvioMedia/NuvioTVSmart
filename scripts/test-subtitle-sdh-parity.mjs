import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  stripSubtitleSdh as strip,
  stripAssSubtitleSdh,
  isSdhSpeakerLabel
} from "../js/core/player/subtitleSdhFilter.js";
import { resolveSubtitleStyleControlAvailability as availability } from "../js/core/player/subtitlePresentationCapabilities.js";
import { createAssRenderer } from "../js/core/player/assRenderer.js";
import { convertAssDialogueToVttCues } from "../js/core/player/assSubtitle.js";

// Android SubtitleSdhFilterTest cases, plus the same bracket/parenthesis rules.
for (const text of [
  "He said:",
  "Here's what I think:",
  "And the winner is:",
  "You know what he told me:\nnever again.",
  "John:",
  "Remember this: run.",
  'He said: "Get out."',
  "I'll tell you what: no.",
  "(123)",
  "（123）",
  "(café)"
])
  assert.equal(strip(text), text);
for (const [input, expected] of [
  ["JOHN:", ""],
  ["JOHN: Hello.", "Hello."],
  ["NARRATOR: Once upon a time", "Once upon a time"],
  ["MAN #2: Get down!", "Get down!"],
  ["DR. HOUSE (V.O.): Come in.", "Come in."],
  ["JOHN:\nReady?", "Ready?"],
  ["John: Hello", "Hello"],
  ["Mr. Smith: Yes, sir.", "Yes, sir."],
  ["Officer Brown: Over here.", "Over here."],
  ["- JOHN: Where are you?\n- Mary: Outside.", "- Where are you?\n- Outside."],
  ["[MUSIC]", ""],
  ["(door creaks)", ""],
  ["（door creaks）", ""],
  ["[John]: Hello.", "Hello."],
  [">> ANNA: Over here.", "Over here."],
  ["[EXPLOSION] Run!", "Run!"],
  ["[MUSIC]\nHello\n-\nWorld", "Hello\nWorld"],
  ["Hello\r\n[MUSIC]\r\nWorld", "Hello\nWorld"],
  ["<b>JOHN:</b> <i>Hello.</i>", "<b></b><i>Hello.</i>"],
  ["<i>[MUSIC]</i>", ""],
  ["<v John>JOHN: Hello.</v>", "<v John>Hello.</v>"]
])
  assert.equal(strip(input), expected, input);
for (const [label, follows, result] of [
  ["JOHN", false, true],
  ["[john]", false, true],
  ["John", true, true],
  ["John", false, false],
  ["He said", true, false],
  ["The One Who Knocks Twice", true, false],
  ["10", true, false]
])
  assert.equal(isSdhSpeakerLabel(label, follows), result);
assert.equal(
  strip("{\\an8}JOHN: {\\i1}Hello{\\i0}\\N[MUSIC]", { ass: true }),
  "{\\an8}{\\i1}Hello{\\i0}"
);
const drawing = "{\\p1}m 0 0 l 20 0 20 20{\\p0}";
assert.equal(strip(drawing, { ass: true }), drawing);
assert.equal(strip(drawing + "[MUSIC]", { ass: true }), drawing);
const ass =
  "[Script Info]\nPlayResX: 640\nPlayResY: 360\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize\nStyle: Default,Arial,30\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.00,Default,John,0,0,0,,{\\an8}JOHN: Hello, world!\nDialogue: 0,0:00:04.00,0:00:05.00,Default,,0,0,0,,[MUSIC]";
const filteredAss = stripAssSubtitleSdh(ass);
assert(filteredAss.includes("Default,John,0,0,0,,{\\an8}Hello, world!"));
assert(filteredAss.includes("Dialogue: 0,0:00:04.00,0:00:05.00,Default,,0,0,0,,"));
assert.equal(filteredAss.split("[Events]")[0], ass.split("[Events]")[0]);
const originalCues = convertAssDialogueToVttCues(ass),
  filteredCues = convertAssDialogueToVttCues(filteredAss);
assert.equal(filteredCues[0].start, originalCues[0].start);
assert.equal(filteredCues[0].end, originalCues[0].end);
assert.equal(filteredCues.length, 1);
assert.equal(availability({ preserveAssStyles: true }).stripSdh, true);
assert.equal(availability({ bitmap: true }).stripSdh, false);
assert.equal(availability({ isWebOsNative: true, rendererMode: "none" }).stripSdh, false);
assert.equal(availability({ isTizenAvPlay: true, rendererMode: "html-callback" }).stripSdh, true);
assert.equal(
  availability({ isTizenAvPlay: true, rendererMode: "external-native" }).stripSdh,
  false
);

async function methods(number, name, internals = {}) {
  const files = await import("node:fs/promises").then((fs) =>
    fs.readdir(new URL("../js/ui/screens/player/", import.meta.url))
  );
  const file = files.find((file) => file.startsWith(`playerScreenMethods-${number}-`));
  const source = await readFile(
    new URL(`../js/ui/screens/player/${file}`, import.meta.url),
    "utf8"
  );
  return new Function(
    "internals",
    "stripSubtitleSdh",
    "syncHtmlSubtitleClearance",
    '"use strict";\n' +
      source.replace(/^import .*;\n/gm, "").replace(/export function/g, "function") +
      `; return ${name}();`
  )(internals, strip, () => {});
}
// Native TextTrack cues are reversible, retain their original timing and basic markup.
const snapshotMethods = await methods("25", "createPlayerScreenMethods25");
const nativeMethods = await methods("26", "createPlayerScreenMethods26");
const screen = {
  ...snapshotMethods,
  ...nativeMethods,
  subtitleStyleSettings: { stripSdh: true },
  hasSubtitleAssSyntax: () => false,
  subtitleCueOriginalState: new WeakMap()
};
const cue = {
  text: "<b>JOHN:</b> <i>Hello.</i>",
  startTime: 1,
  endTime: 3,
  line: 20,
  position: 50
};
assert.equal(screen.sanitizeSubtitleCueText(cue), true);
assert.equal(cue.text, "<b></b><i>Hello.</i>");
assert.equal(cue.startTime, 1);
assert.equal(cue.endTime, 3);
assert.equal(cue.line, 20);
const cachedText = screen.getSubtitleCueSnapshot(cue).sdhText;
assert.equal(screen.sanitizeSubtitleCueText(cue), false);
assert.equal(screen.getSubtitleCueSnapshot(cue).sdhText, cachedText);
screen.subtitleStyleSettings.stripSdh = false;
screen.sanitizeSubtitleCueText(cue);
assert.equal(cue.text, "<b>JOHN:</b> <i>Hello.</i>");
const sound = { text: "[MUSIC]", startTime: 4, endTime: 5 };
screen.subtitleStyleSettings.stripSdh = true;
screen.sanitizeSubtitleCueText(sound);
assert.equal(sound.text, "");
screen.subtitleStyleSettings.stripSdh = false;
screen.sanitizeSubtitleCueText(sound);
assert.equal(sound.text, "[MUSIC]");
// Native-to-HTML handoff must start from the original cue, avoiding a second label removal.
const chain = { text: "JOHN: Peter: Hello.", startTime: 1, endTime: 3 };
screen.subtitleStyleSettings.stripSdh = true;
screen.sanitizeSubtitleCueText(chain);
assert.equal(chain.text, "Peter: Hello.");
const projectionMethods = await methods("25", "createPlayerScreenMethods25", {
  buildHtmlSubtitleCue: (cue, snapshot, text) => ({ ...cue, text })
});
screen.parseSubtitleCueText = (value) => value;
const projected = projectionMethods.buildWebOsEmbeddedHtmlSubtitleCues.call(screen, {
  cues: [chain]
});
assert.equal(strip(projected[0].text), "Peter: Hello.");

// In-band/live caption engines may update an existing cue; never restore an older caption.
chain.text = "MARY: New caption.";
screen.sanitizeSubtitleCueText(chain);
assert.equal(chain.text, "New caption.");
screen.subtitleStyleSettings.stripSdh = false;
screen.sanitizeSubtitleCueText(chain);
assert.equal(chain.text, "MARY: New caption.");

// Read-only native cues take the existing replacement path and carry the original snapshot.
class FakeCue {
  constructor(startTime, endTime, text) {
    Object.assign(this, { startTime, endTime, text, line: 0 });
  }
}
globalThis.VTTCue = FakeCue;
const readonly = {
  startTime: 6,
  endTime: 8,
  get text() {
    return "JOHN: Ready?";
  },
  line: 10
};
let replacement;
screen.subtitleStyleSettings.stripSdh = true;
assert(
  screen.sanitizeSubtitleCueText(readonly, {
    removeCue() {},
    addCue(cue) {
      replacement = cue;
    }
  })
);
assert.equal(replacement.text, "Ready?");
assert.equal(replacement.line, 10);
screen.subtitleStyleSettings.stripSdh = false;
screen.sanitizeSubtitleCueText(replacement);
assert.equal(replacement.text, "JOHN: Ready?");
delete globalThis.VTTCue;

// ASS adapter receives a filtered script only when enabled; disabling recreates from original bytes.
let renderedAss;
globalThis.ASS = class {
  constructor(body) {
    renderedAss = body;
  }
  destroy() {}
};
globalThis.ResizeObserver = class {};
const container = { childNodes: [], textContent: "", replaceChildren() {} },
  video = { paused: true };
const renderer = createAssRenderer({
  body: ass,
  stripSdh: true,
  video,
  container,
  selectionToken: 1,
  isCurrentSelection: () => true
});
assert.equal((await renderer.init()).ok, true);
assert.equal(renderedAss, filteredAss);
assert.equal(renderer.sourceBody, ass);
renderer.destroy();
const originalRenderer = createAssRenderer({
  body: ass,
  stripSdh: false,
  video,
  container,
  selectionToken: 1,
  isCurrentSelection: () => true
});
assert.equal((await originalRenderer.init()).ok, true);
assert.equal(renderedAss, ass);
originalRenderer.destroy();
delete globalThis.ASS;
delete globalThis.ResizeObserver;
// App-rendered cues share the filter: sidecars, extracted embedded text and AVPlay callbacks.
class Element {
  constructor() {
    this.childNodes = [];
    this.attributes = {};
    this.style = {};
    this.classes = new Set();
    this.replacements = 0;
    this.classList = {
      add: (value) => this.classes.add(value),
      remove: (value) => this.classes.delete(value),
      contains: (value) => this.classes.has(value)
    };
  }
  set textContent(text) {
    this.text = text;
  }
  get textContent() {
    return (this.text || "") + this.childNodes.map((node) => node.textContent).join("");
  }
  setAttribute(key, value) {
    this.attributes[key] = value;
  }
  getAttribute(key) {
    return this.attributes[key];
  }
  replaceChildren() {
    this.childNodes = [];
    this.text = "";
    this.replacements++;
  }
  appendChild(node) {
    this.childNodes.push(node);
  }
}
globalThis.document = { createElement: () => new Element() };
const overlay = new Element(),
  htmlMethods = await methods("45", "createPlayerScreenMethods45", {
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    normalizeWebOsHtmlSubtitleText: (value) => value
  });
const htmlScreen = {
  ...htmlMethods,
  subtitleStyleSettings: { stripSdh: true },
  uiRefs: { htmlSubtitles: overlay }
};
const active = [{ start: 1, end: 3, text: "JOHN: Hello." }];
htmlScreen.renderHtmlSubtitleOverlayCue(active);
assert(overlay.textContent.includes("Hello."));
assert(!overlay.textContent.includes("JOHN:"));
assert.equal(active[0].text, "JOHN: Hello.");
htmlScreen.subtitleStyleSettings.stripSdh = false;
htmlScreen.renderHtmlSubtitleOverlayCue(htmlScreen.htmlSubtitleLastActiveCues);
assert(overlay.textContent.includes("JOHN: Hello."));
htmlScreen.subtitleStyleSettings.stripSdh = true;
const noise = [{ start: 4, end: 5, text: "[MUSIC]" }];
htmlScreen.renderHtmlSubtitleOverlayCue(noise);
assert(overlay.classList.contains("hidden"));
assert.equal(overlay.childNodes.length, 0);
const repaintCount = overlay.replacements;
htmlScreen.renderHtmlSubtitleOverlayCue(noise);
assert.equal(overlay.replacements, repaintCount);
htmlScreen.subtitleStyleSettings.stripSdh = false;
htmlScreen.renderHtmlSubtitleOverlayCue(noise);
assert(overlay.textContent.includes("[MUSIC]"));
const pending = [];
const assMethods = await methods("43", "createPlayerScreenMethods43", {
  Environment: { isWebOS: () => false },
  PlayerController: { video: {} },
  convertAssBodyToVtt: () => "WEBVTT",
  createAssRenderer: (options) => {
    const renderer = {
      options,
      active: true,
      destroy() {
        this.destroyed = true;
      },
      setDelay(value) {
        this.delay = value;
      },
      init: () => new Promise((resolve) => pending.push({ renderer, resolve }))
    };
    return renderer;
  }
});
const assScreen = {
  ...assMethods,
  subtitleStyleSettings: { stripSdh: true },
  subtitleSelectionToken: 1,
  subtitleDelayMs: 250,
  getAssSubtitleContainer: () => overlay,
  showAssSubtitleContainer() {
    this.shown = this.assSubtitleRenderer;
  }
};
const first = assScreen.applyAssSubtitleBody({ body: ass, selectionToken: 1 });
assScreen.subtitleStyleSettings.stripSdh = false;
const second = assScreen.applyAssSubtitleBody({ body: ass, selectionToken: 1 });
pending[1].resolve({ ok: true });
assert.equal((await second).applied, true);
const winner = assScreen.assSubtitleRenderer;
pending[0].resolve({ ok: true });
assert.equal((await first).applied, false);
assert.equal(assScreen.assSubtitleRenderer, winner);
assert(!winner.destroyed);
assert.equal(winner.options.stripSdh, false);
assert.equal(winner.delay, 250);
assScreen.subtitleSelectionToken = 2;
assert.equal(
  (await assScreen.applyAssSubtitleBody({ body: ass, selectionToken: 1 })).applied,
  false
);
assert.equal(assScreen.assSubtitleRenderer, winner);
// A live ASS style change rebuilds from the original; parse failures use the existing HTML fallback.
const properties = { setProperty() {}, removeProperty() {} };
const presentation = await methods("24", "createPlayerScreenMethods24", {
  PlayerController: { video: { style: properties } },
  Environment: { isWebOS: () => false, isTizen: () => false },
  getSubtitleVerticalOffsetVh: () => 0,
  getSubtitleVerticalResidualOffsetVh: () => 0,
  normalizeSubtitleTextOpacity: (value) => value ?? 100,
  subtitleTextColorWithOpacity: (value) => value,
  normalizeSubtitleFontSize: (value) => value ?? 100,
  formatHtmlSubtitleFontSize: (value) => String(value)
});
let rebuild,
  scheduled = false;
const presentationScreen = {
  ...htmlMethods,
  subtitleStyleSettings: { stripSdh: true },
  subtitleSelectionToken: 3,
  selectedAddonSubtitleId: "fixture",
  assSubtitleRenderer: { sourceBody: ass, stripSdh: false },
  uiRefs: { root: { style: properties }, htmlSubtitles: overlay },
  applyAssSubtitleBody(options) {
    rebuild = options;
    this.assSubtitleRenderer = null;
    return Promise.resolve({ applied: false, fallbackVtt: "WEBVTT" });
  },
  clearHtmlSubtitleOverlay() {
    this.htmlSubtitleCues = [];
    this.htmlSubtitleLastActiveCues = [];
  },
  parseSubtitleCues: () => [{ start: 0, end: 4, text: "JOHN: Hello." }],
  getPlaybackCurrentSeconds: () => 1,
  refreshSubtitleCueStyles() {},
  renderBitmapSubtitleAtCurrentTime() {},
  scheduleHtmlSubtitleOverlayRender() {
    scheduled = true;
  }
};
presentation.applySubtitlePresentationSettings.call(presentationScreen);
await new Promise((resolve) => setImmediate(resolve));
assert.equal(rebuild.body, ass);
assert.equal(rebuild.selectionToken, 3);
assert(scheduled);
assert.equal(presentationScreen.htmlSubtitleSelectedId, "fixture");
assert(!overlay.textContent.includes("JOHN:"));
assert(overlay.textContent.includes("Hello."));

// Profile persistence uses the existing settings contract, with filtering off by default.
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key)
};
const { PlayerSettingsStore, normalizePlayerSettings } =
  await import("../js/data/local/playerSettingsStore.js");
assert.equal(normalizePlayerSettings({}).subtitleStyle.stripSdh, false);
PlayerSettingsStore.setForProfile("1", { subtitleStyle: { stripSdh: true } }, { silentSync: true });
assert.equal(PlayerSettingsStore.getForProfile("1").subtitleStyle.stripSdh, true);
PlayerSettingsStore.setForProfile(
  "2",
  { subtitleStyle: { stripSdh: false } },
  { silentSync: true }
);
assert.equal(PlayerSettingsStore.getForProfile("2").subtitleStyle.stripSdh, false);
assert.equal(PlayerSettingsStore.getForProfile("1").subtitleStyle.stripSdh, true);

console.log(
  "SDH parity passed: Android rules, formatting, ASS timings/drawings, reversible native cues and renderer capabilities."
);
