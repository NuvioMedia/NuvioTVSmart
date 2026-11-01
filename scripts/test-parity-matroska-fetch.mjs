import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fetchMatroskaChapters } from "../js/data/repository/matroskaChapters.js";

function sizeVint(value) {
  let length = 1;
  while (value >= 2 ** (7 * length) - 1) length += 1;
  const bytes = new Uint8Array(length);
  let remaining = value;
  for (let index = length - 1; index >= 0; index -= 1) {
    bytes[index] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  bytes[0] |= 0x80 >> (length - 1);
  return bytes;
}
function concat(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}
function element(id, payload = new Uint8Array()) {
  return concat([new Uint8Array(id), sizeVint(payload.length), payload]);
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
  ebml: [0x1a, 0x45, 0xdf, 0xa3],
  segment: [0x18, 0x53, 0x80, 0x67],
  seekHead: [0x11, 0x4d, 0x9b, 0x74],
  seek: [0x4d, 0xbb],
  seekId: [0x53, 0xab],
  seekPosition: [0x53, 0xac],
  chapters: [0x10, 0x43, 0xa7, 0x70],
  edition: [0x45, 0xb9],
  atom: [0xb6],
  start: [0x91],
  display: [0x80],
  string: [0x85],
  void: [0xec]
};
function chapter(startMs, title) {
  return element(
    ID.atom,
    concat([
      element(ID.start, uint8(startMs * 1_000_000)),
      element(ID.display, element(ID.string, text(title)))
    ])
  );
}
const chapters = element(
  ID.chapters,
  element(ID.edition, concat([chapter(0, "Intro"), chapter(90_000, "Opening")]))
);
const placeholderSeekHead = element(
  ID.seekHead,
  element(ID.seek, concat([element(ID.seekId, ID.chapters), element(ID.seekPosition, uint8(0))]))
);
const padding = element(ID.void, new Uint8Array(300 * 1024));
const chaptersOffset = placeholderSeekHead.length + padding.length;
const seekHead = element(
  ID.seekHead,
  element(
    ID.seek,
    concat([element(ID.seekId, ID.chapters), element(ID.seekPosition, uint8(chaptersOffset))])
  )
);
assert.equal(seekHead.length, placeholderSeekHead.length);
const file = concat([element(ID.ebml), element(ID.segment, concat([seekHead, padding, chapters]))]);

const server = createServer((request, response) => {
  const match = String(request.headers.range || "").match(/^bytes=(\d+)-(\d+)$/);
  if (!match) {
    response.writeHead(200, { "Content-Length": file.length });
    response.end(Buffer.from(file));
    return;
  }
  const start = Number(match[1]);
  const end = Math.min(file.length - 1, Number(match[2]));
  if (start >= file.length || start > end) {
    response.writeHead(416);
    response.end();
    return;
  }
  const body = Buffer.from(file.subarray(start, end + 1));
  response.writeHead(206, {
    "Content-Range": `bytes ${start}-${end}/${file.length}`,
    "Content-Length": body.length
  });
  response.end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
try {
  const parsed = await fetchMatroskaChapters(`http://127.0.0.1:${port}/movie.mkv`);
  assert.deepEqual(parsed, [
    { startMs: 0, title: "Intro" },
    { startMs: 90_000, title: "Opening" }
  ]);
  console.log("Matroska chapter range fetch passed: SeekHead beyond the initial probe.");
} finally {
  server.close();
}
