import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isAssSubtitle,
  convertAssDialogueToVttCues,
  buildVttFromAssCues,
  convertAssBodyToVtt
} from "../../../js/core/player/assSubtitle.js";

const VALID_ASS = [
  "[Script Info]",
  "ScriptType: v4.00+",
  "",
  "[V4+ Styles]",
  "Format: Name, Fontname",
  "Style: Default,Arial",
  "",
  "[Events]",
  "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  "Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,Hello world",
  "Dialogue: 0,0:00:04.00,0:00:06.00,Default,,0,0,0,,Second {\\i1}line{\\i0} here"
].join("\n");

test("detects ASS with section headers", () => {
  assert.equal(isAssSubtitle(VALID_ASS), true);
});

test("detects ASS with BOM and CRLF", () => {
  assert.equal(isAssSubtitle(`\uFEFF${VALID_ASS.replace(/\n/g, "\r\n")}`), true);
});

test("rejects incidental ASS-like prose in non-ASS bodies", () => {
  // Bracketed prose on a dialogue line must not match a section header.
  const prose = "1\n00:00:01,000 --> 00:00:03,000\n[Events] tonight we watch";
  assert.equal(isAssSubtitle(prose), false);
  const vttProse = "WEBVTT\n\n00:01.000 --> 00:03.000\nSee [Script Info] below";
  assert.equal(isAssSubtitle(vttProse), false);
  const plain = "Some random note\n[Events]\nwithout dialogue lines";
  assert.equal(isAssSubtitle(plain), false);
});

test("detects SSA via URL metadata plus dialogue events", () => {
  const ssa = ["[Events]", "Format: Start, End, Text", "Dialogue: 0:00:01.00,0:00:02.00,Hi"].join(
    "\n"
  );
  assert.equal(isAssSubtitle(ssa, { sourceUrl: "http://x/sub.ssa" }), true);
});

test("detects ASS via content-type metadata", () => {
  const body = ["Format: Start, End, Text", "Dialogue: 0:00:01.00,0:00:02.00,Hi"].join("\n");
  assert.equal(isAssSubtitle(body, { contentType: "text/x-ssa; charset=utf-8" }), true);
});

test("rejects SRT and VTT bodies", () => {
  assert.equal(
    isAssSubtitle("1\n00:00:01,000 --> 00:00:03,000\nHello", {
      sourceUrl: "http://x/sub.ass"
    }),
    false
  );
  assert.equal(isAssSubtitle("WEBVTT\n\n00:01.000 --> 00:03.000\nHello"), false);
});

test("rejects incidental ASS-like text in dialogue", () => {
  const vtt = "WEBVTT\n\n00:01.000 --> 00:03.000\n{\\an8}Some text";
  assert.equal(isAssSubtitle(vtt), false);
  const srt = "1\n00:00:01,000 --> 00:00:03,000\n{\\an8}Some text";
  assert.equal(isAssSubtitle(srt), false);
});

test("rejects empty and non-ASS bodies", () => {
  assert.equal(isAssSubtitle(""), false);
  assert.equal(isAssSubtitle("just some plain text"), false);
});

test("converts dialogue events to cues with sanitized text", () => {
  const cues = convertAssDialogueToVttCues(VALID_ASS);
  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0], { start: 1, end: 3.5, text: "Hello world" });
  assert.equal(cues[1].text, "Second line here");
});

test("keeps line breaks and converts \\h", () => {
  const body = [
    "[Events]",
    "Format: Start, End, Text",
    "Dialogue: 0:00:01.00,0:00:02.00,First\\NSecond\\hpart"
  ].join("\n");
  const cues = convertAssDialogueToVttCues(body);
  assert.equal(cues[0].text, "First\nSecond part");
});

test("handles BOM and CRLF in conversion", () => {
  const body = `\uFEFF${[
    "[Events]",
    "Format: Start, End, Text",
    "Dialogue: 0:00:01.00,0:00:02.00,Hello"
  ].join("\r\n")}`;
  const cues = convertAssDialogueToVttCues(body);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].text, "Hello");
});

test("drops malformed events", () => {
  const body = [
    "[Events]",
    "Format: Start, End, Text",
    "Dialogue: garbage,0:00:02.00,Bad",
    "Dialogue: 0:00:05.00,0:00:04.00,Reversed",
    "Dialogue: 0:00:01.00,0:00:02.00,{\\an8}",
    "Dialogue: 0:00:01.00,0:00:02.00,Good"
  ].join("\n");
  const cues = convertAssDialogueToVttCues(body);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].text, "Good");
});

test("sorts cues by start time", () => {
  const body = [
    "[Events]",
    "Format: Start, End, Text",
    "Dialogue: 0:00:10.00,0:00:11.00,Late",
    "Dialogue: 0:00:01.00,0:00:02.00,Early"
  ].join("\n");
  const cues = convertAssDialogueToVttCues(body);
  assert.deepEqual(
    cues.map((cue) => cue.text),
    ["Early", "Late"]
  );
});

test("builds VTT with proper timestamps", () => {
  const vtt = convertAssBodyToVtt(VALID_ASS);
  assert.match(vtt, /^WEBVTT\n\n/);
  assert.match(vtt, /00:00:01\.000 --> 00:00:03\.500\nHello world/);
  assert.match(vtt, /00:00:04\.000 --> 00:00:06\.000\nSecond line here/);
});

test("buildVttFromAssCues returns empty string without cues", () => {
  assert.equal(buildVttFromAssCues([]), "");
  assert.equal(buildVttFromAssCues(null), "");
});

test("commas inside dialogue text survive field splitting", () => {
  const body = [
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hello, world, again"
  ].join("\n");
  const cues = convertAssDialogueToVttCues(body);
  assert.equal(cues[0].text, "Hello, world, again");
});

test("accepts lowercase ASS event keywords and three-digit fractions", () => {
  const body = [
    "[Events]",
    "format: Start, End, Text",
    "dialogue: 0:00:01.000,0:00:02.500,Three digit timing"
  ].join("\n");
  assert.equal(isAssSubtitle(body), true);
  assert.deepEqual(convertAssDialogueToVttCues(body), [
    { start: 1, end: 2.5, text: "Three digit timing" }
  ]);
});
