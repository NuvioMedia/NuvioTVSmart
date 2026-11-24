import test from "node:test";
import assert from "node:assert/strict";

const stored = new Map();
globalThis.localStorage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, value),
  removeItem: (key) => stored.delete(key)
};
const { createPlayerScreenMethods49 } =
  await import("../js/ui/screens/player/playerScreenMethods-49-collect-subtitle-option-items.js");
const { getSubtitleFormatBadge, getAddonSubtitleFormatBadge } =
  await import("../js/ui/screens/player/playerScreenHelpers-04-format-subtitle-codec-label.js");

const methods = createPlayerScreenMethods49();
const collect = (builtIn = [], addons = []) =>
  methods.collectSubtitleOptionItems.call({
    trackDialogCache: {},
    getSubtitleOptionStableId: methods.getSubtitleOptionStableId,
    getSubtitleEntries: (tab) => (tab === "builtIn" ? builtIn : addons)
  });

// Android 8efa5ca57 internalSubtitleTitle and 4db6cbabd format badges.
test("built-in subtitles show the track label, else the language name, never the code or codec", () => {
  const [labelled, codeOnly, unknown] = collect([
    { id: "t0", track: { name: "English SDH", language: "eng", codec: "S_TEXT/ASS" } },
    { id: "t1", track: { name: "pol", language: "pol", codec: "S_TEXT/UTF8" } },
    { id: "t2", track: { codec: "S_HDMV/PGS" } }
  ]);
  assert.equal(labelled.title, "English SDH");
  assert.equal(labelled.formatBadge, "ASS");
  assert.equal(labelled.meta, "");
  assert.equal(codeOnly.title, "Polish");
  assert.equal(codeOnly.formatBadge, null);
  assert.equal(codeOnly.meta, "", "the codec is no longer listed");
  assert.equal(unknown.title, "Unknown");
  assert.equal(unknown.formatBadge, "PGS");
});

test("a forced built-in track keeps Forced as its only description", () => {
  const [forced] = collect([
    { id: "t0", isForced: true, track: { name: "Signs", language: "eng", codec: "ass" } }
  ]);
  assert.equal(forced.meta, "Forced");
});

// Android a15263778 / 12c125ef9: the Stremio label is the title, the id the description.
test("add-on subtitles show the Stremio label as the title and keep the id below", () => {
  const [labelled, plain] = collect(
    [],
    [
      {
        id: "a0",
        secondary: "OpenSubtitles",
        track: {
          id: "os-123",
          lang: "eng",
          stremioLabel: "English (Release.Group)",
          url: "https://x.invalid/a.ass?x=1"
        }
      },
      {
        id: "a1",
        secondary: "OpenSubtitles",
        track: { id: "os-124", lang: "eng", url: "https://x.invalid/b.srt" }
      }
    ]
  );
  assert.equal(labelled.title, "English (Release.Group)");
  assert.equal(labelled.meta, "os-123");
  assert.equal(labelled.formatBadge, "ASS");
  assert.equal(plain.title, "English");
  assert.equal(plain.formatBadge, null);
});

test("format badges cover the codec ids, MIME types and ffprobe names the TVs report", () => {
  for (const codec of ["S_TEXT/ASS", "S_TEXT/SSA", "ASS", "text/x-ssa", "ssa"]) {
    assert.equal(getSubtitleFormatBadge({ codec }), "ASS", codec);
  }
  for (const codec of [
    "S_HDMV/PGS",
    "HDMV/PGS",
    "hdmv_pgs_subtitle",
    "pgssub",
    "application/pgs"
  ]) {
    assert.equal(getSubtitleFormatBadge({ codec_name: codec }), "PGS", codec);
  }
  for (const codec of ["S_VOBSUB", "VOBSUB", "dvd_subtitle", "dvdsub"]) {
    assert.equal(getSubtitleFormatBadge({ codecId: codec }), "VobSub", codec);
  }
  for (const codec of ["S_DVBSUB", "dvb_subtitle", "dvbsub", "application/dvbsubs"]) {
    assert.equal(getSubtitleFormatBadge({ codec }), "DVB", codec);
  }
  for (const codec of ["S_TEXT/UTF8", "subrip", "webvtt", "mov_text", ""]) {
    assert.equal(getSubtitleFormatBadge({ codec }), null, codec);
  }
  assert.equal(getSubtitleFormatBadge({ bitmapSubtitleFormat: "pgs" }), "PGS");
  assert.equal(getAddonSubtitleFormatBadge({ url: "https://x.invalid/sub.SSA#t=1" }), "ASS");
  assert.equal(getAddonSubtitleFormatBadge({ url: "https://x.invalid/download/123" }), null);
});
