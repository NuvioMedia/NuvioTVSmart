import test from "node:test";
import assert from "node:assert/strict";

import {
  isMatroskaSource,
  matroskaChapterLayout,
  matroskaSeekHeadPositions,
  parseMatroskaChapters
} from "../js/data/repository/matroskaChapters.js";

function sizeVint(value) {
  let length = 1;
  while (value >= 2 ** (7 * length) - 1) {
    length += 1;
  }
  const bytes = new Uint8Array(length);
  let remaining = value;
  for (let index = length - 1; index >= 0; index -= 1) {
    bytes[index] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  bytes[0] |= 0x80 >> (length - 1);
  return bytes;
}

function element(id, payload = new Uint8Array()) {
  const size = sizeVint(payload.length);
  const bytes = new Uint8Array(id.length + size.length + payload.length);
  bytes.set(id, 0);
  bytes.set(size, id.length);
  bytes.set(payload, id.length + size.length);
  return bytes;
}

function uint8(value) {
  const bytes = new Uint8Array(8);
  let remaining = value;
  for (let index = 7; index >= 0; index -= 1) {
    bytes[index] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  return bytes;
}

function text(value) {
  return new TextEncoder().encode(value);
}

const ID = {
  chapters: [0x10, 0x43, 0xa7, 0x70],
  edition: [0x45, 0xb9],
  editionHidden: [0x45, 0xbd],
  editionDefault: [0x45, 0xdb],
  atom: [0xb6],
  start: [0x91],
  hidden: [0x98],
  enabled: [0x45, 0x98],
  display: [0x80],
  string: [0x85]
};

function atom(startMs, title, { hidden = false, enabled = true } = {}) {
  const payload = [
    element(ID.start, uint8(startMs * 1_000_000)),
    ...(hidden ? [element(ID.hidden, uint8(1))] : []),
    ...(enabled ? [] : [element(ID.enabled, uint8(0))]),
    element(ID.display, element(ID.string, text(title)))
  ];
  return element(ID.atom, concat(payload));
}

function concat(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  parts.forEach((part) => {
    bytes.set(part, offset);
    offset += part.length;
  });
  return bytes;
}

test("parses the default edition, chapter starts and titles", () => {
  const hiddenEdition = element(
    ID.edition,
    concat([element(ID.editionHidden, uint8(1)), atom(0, "Hidden")])
  );
  const defaultEdition = element(
    ID.edition,
    concat([
      element(ID.editionDefault, uint8(1)),
      atom(0, "Intro"),
      atom(90_000, "Opening"),
      atom(1_320_000, "Credits", { hidden: true }),
      atom(1_400_000, "Disabled", { enabled: false })
    ])
  );
  const chapters = element(ID.chapters, concat([hiddenEdition, defaultEdition]));

  assert.deepEqual(parseMatroskaChapters(chapters), [
    { startMs: 0, title: "Intro" },
    { startMs: 90_000, title: "Opening" }
  ]);
});

test("rejects malformed chapter elements without throwing", () => {
  assert.deepEqual(parseMatroskaChapters(new Uint8Array([0x10, 0x43, 0xa7, 0x70])), []);
  assert.deepEqual(parseMatroskaChapters(new Uint8Array()), []);
});

test("locates chapters through a top-level element and a SeekHead", () => {
  const chapters = element(
    ID.chapters,
    element(ID.edition, atom(0, "Intro") + atom(90_000, "Opening"))
  );
  const seekHead = element(
    [0x11, 0x4d, 0x9b, 0x74],
    element(
      [0x4d, 0xbb],
      concat([element([0x53, 0xab], ID.chapters), element([0x53, 0xac], uint8(0))])
    )
  );
  const segmentPayload = concat([seekHead, chapters]);
  const segment = element([0x18, 0x53, 0x80, 0x67], segmentPayload);
  const file = concat([element([0x1a, 0x45, 0xdf, 0xa3]), segment]);

  const layout = matroskaChapterLayout(file);
  assert.equal(layout.segmentDataStart, file.length - segmentPayload.length);
  assert.equal(layout.seekHeadPosition, layout.segmentDataStart);
  assert.equal(layout.chaptersPosition, layout.segmentDataStart + seekHead.length);
  assert.equal(matroskaSeekHeadPositions(seekHead).get(0x1043a770), 0);
});

test("only Matroska sources are probed", () => {
  assert.equal(isMatroskaSource("https://cdn.example/movie.mkv"), true);
  assert.equal(isMatroskaSource("https://cdn.example/movie.webm"), true);
  assert.equal(isMatroskaSource("https://cdn.example/movie.mp4"), false);
  assert.equal(isMatroskaSource("https://cdn.example/master.m3u8"), false);
  assert.equal(
    isMatroskaSource("https://cdn.example/stream", { mimeType: "video/x-matroska" }),
    true
  );
  assert.equal(
    isMatroskaSource("https://cdn.example/stream", {
      behaviorHints: { filename: "Movie.WEB-DL.mkv" }
    }),
    true
  );
});
