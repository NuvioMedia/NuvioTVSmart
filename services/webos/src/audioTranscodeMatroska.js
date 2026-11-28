const t = require("./bitmapSubtitles").matroska;
function children(b, s, end) {
  const out = [];
  while (s < end) {
    const e = t.readElement(b, s, end, false);
    if (!e || e.truncated) throw Error("truncated");
    out.push(e);
    s = e.declaredDataEnd;
  }
  return out;
}
function size(n, w) {
  if (!w) for (w = 1; w <= 8 && n >= 2 ** (7 * w) - 1; w++);
  if (n >= 2 ** (7 * w) - 1) throw Error("size");
  const b = Buffer.alloc(w);
  for (let i = w - 1; i >= 0; i--) {
    b[i] = n % 256;
    n = Math.floor(n / 256);
  }
  b[0] |= 1 << (8 - w);
  return b;
}
function voidPad(n) {
  for (let w = 1; w <= 8; w++) {
    const p = n - w - 1;
    if (p >= 0 && p < 2 ** (7 * w) - 1)
      return Buffer.concat([Buffer.from([0xec]), size(p, w), Buffer.alloc(p)]);
  }
  throw Error("padding");
}
function vint(b, p, signed) {
  let w = 1;
  for (; w <= 8 && !(b[p] & (1 << (8 - w))); w++);
  if (w > 8 || p + w > b.length) throw Error("vint");
  let n = b[p] & ((1 << (8 - w)) - 1);
  for (let i = 1; i < w; i++) n = n * 256 + b[p + i];
  return { n: signed ? n - (2 ** (7 * w - 1) - 1) : n, w };
}
function packets(b, e) {
  let p = e.dataStart;
  const tn = vint(b, p);
  p += tn.w;
  const relative = b.readInt16BE(p),
    flags = b[p + 2];
  p += 3;
  const lace = flags & 6,
    sizes = [];
  if (!lace) sizes.push(e.dataEnd - p);
  else {
    const count = b[p++] + 1;
    if (lace === 4) {
      if ((e.dataEnd - p) % count) throw Error("fixed-lacing");
      for (let i = 0; i < count; i++) sizes.push((e.dataEnd - p) / count);
    } else {
      let total = 0;
      for (let i = 0; i < count - 1; i++) {
        let n;
        if (lace === 2) {
          n = 0;
          let x;
          do {
            x = b[p++];
            n += x;
          } while (x === 255 && p < e.dataEnd);
        } else {
          let v = vint(b, p, i !== 0);
          p += v.w;
          n = i === 0 ? v.n : sizes[i - 1] + v.n;
        }
        if (n < 0 || n > 1048576) throw Error("packet-size");
        sizes.push(n);
        total += n;
      }
      sizes.push(e.dataEnd - p - total);
    }
  }
  const frames = [];
  for (const n of sizes) {
    if (n < 0 || p + n > e.dataEnd) throw Error("lacing");
    frames.push(b.subarray(p, p + n));
    p += n;
  }
  if (p !== e.dataEnd) throw Error("lacing-end");
  return { track: tn.n, relative, frames };
}
function dtsSamples(b) {
  if (b.length < 8 || b.readUInt32BE(0) !== 0x7ffe8001) throw Error("dts-header");
  return ((((b[4] & 1) << 6) | (b[5] >> 2)) + 1) * 32;
}
function trueHdSamples(b) {
  if (b.length < 8 || (b.readUInt16BE(0) & 4095) * 2 !== b.length) throw Error("truehd-header");
  // This bounded path accepts only the 48 kHz family declared by the track.
  if (b.readUInt32BE(4) === 0xf8726fba && (b.length < 9 || b[8] >> 4 !== 0))
    throw Error("truehd-rate");
  return 40;
}
function parse(b, start, track, format) {
  const samples = format === "truehd" ? trueHdSamples : dtsSamples;
  const slots = [],
    input = [];
  let first = null,
    last = null;
  const inputPts = [];
  let previousSlot = null;
  for (const c of children(b, 0, b.length)) {
    if (c.id !== 0x1f43b675) continue;
    const list = children(b, c.dataStart, c.dataEnd),
      tc = list.find((e) => e.id === 0xe7);
    let clock = 0;
    for (let i = tc.dataStart; i < tc.dataEnd; i++) clock = clock * 256 + b[i];
    for (const e of list) {
      if (e.id === 0xbf) {
        slots.push({ e, crc: true });
        continue;
      }
      if (e.id === 0xa0) {
        const block = children(b, e.dataStart, e.dataEnd).find((x) => x.id === 0xa1);
        if (block && packets(b, block).track === track) throw Error("block-group");
      }
      if (e.id !== 0xa3) {
        previousSlot = null;
        continue;
      }
      const p = packets(b, e);
      if (p.track !== track) {
        previousSlot = null;
        continue;
      }
      if (format === "truehd" && input.length + p.frames.length > 16384)
        throw Error("audio-packet-budget");
      const pts = clock + p.relative,
        duration = p.frames.reduce((n, f) => n + samples(f) / 48, 0);
      if (format === "truehd" && previousSlot?.e.declaredDataEnd === e.start) {
        previousSlot.e = { ...previousSlot.e, declaredDataEnd: e.declaredDataEnd };
        previousSlot.end = pts + duration;
      } else {
        previousSlot = { e, clock, pts, end: pts + duration, cluster: c.start };
        slots.push(previousSlot);
      }
      if (format === "truehd") p.frames.forEach((f, i) => inputPts.push(pts + (i * 40) / 48));
      Array.prototype.push.apply(input, p.frames);
      if (first === null) first = pts;
      last = pts + duration;
    }
  }
  if (first === null) throw Error("no-audio");
  return { start, b, slots, input, inputPts, first, last, trackNumber: track, format };
}
function project(ctx, frames, anchor, firstFrame) {
  const out = ctx.b;
  const groups = new Map();
  for (const slot of ctx.slots) {
    if (slot.drop || slot.crc) continue;
    if (!groups.has(slot.cluster)) groups.set(slot.cluster, []);
    groups.get(slot.cluster).push(slot);
  }
  // Plan before touching the source bytes. A 32 ms AC3 frame need not fit in
  // the original 10.67 ms DTS block; its timestamp is relative to the Cluster,
  // so another audio slot in that same Cluster can hold it at the original PTS.
  const assignments = new Map();
  let used = 0;
  for (const slots of groups.values()) {
    const first = used;
    const end = slots[slots.length - 1].end;
    let target = first;
    while (target < frames.length && anchor + (firstFrame + target) * 32 < end - 0.5) target++;
    for (const slot of slots) {
      const capacity = Math.max(0, Math.floor((slot.e.declaredDataEnd - slot.e.start - 2) / 2567));
      let count = 0;
      while (
        used < target &&
        count < capacity &&
        anchor + (firstFrame + used) * 32 < slot.end - 0.5
      ) {
        used++;
        count++;
      }
      assignments.set(slot, { first: used - count, count });
    }
    if (used < target) {
      // A small final slot may require spare space earlier in the Cluster.
      // Repack only this Cluster, retaining frame order and original timestamps.
      used = first;
      for (const slot of slots) {
        const capacity = Math.max(
          0,
          Math.floor((slot.e.declaredDataEnd - slot.e.start - 2) / 2567)
        );
        const count = Math.min(capacity, target - used);
        assignments.set(slot, { first: used, count });
        used += count;
      }
      if (used !== target) throw Error("slot-capacity");
    }
    for (const slot of slots) {
      const assignment = assignments.get(slot);
      for (let i = 0; i < assignment.count; i++) {
        const relative = Math.round(anchor + (firstFrame + assignment.first + i) * 32 - slot.clock);
        if (relative < -32768 || relative > 32767) throw Error("slot-timestamp");
        if (frames[assignment.first + i].length !== 2560) throw Error("ac3-frame-size");
      }
    }
  }
  for (const slot of ctx.slots) {
    const e = slot.e;
    if (slot.drop || slot.crc) {
      voidPad(e.declaredDataEnd - e.start).copy(out, e.start);
      continue;
    }
    const assignment = assignments.get(slot),
      parts = [];
    for (let i = 0; i < assignment.count; i++) {
      const index = assignment.first + i,
        block = Buffer.alloc(4);
      block[0] = 0x80 | ctx.trackNumber;
      block.writeInt16BE(Math.round(anchor + (firstFrame + index) * 32 - slot.clock), 1);
      block[3] = 128;
      parts.push(Buffer.concat([Buffer.from([0xa3]), size(2564), block, frames[index]]));
    }
    const payload = Buffer.concat(parts);
    const remaining = e.declaredDataEnd - e.start - payload.length;
    if (remaining < 2) throw Error("slot-overflow");
    Buffer.concat([payload, voidPad(remaining)]).copy(out, e.start);
  }
  return { out, used };
}
module.exports = { parse, project, children, size, voidPad };
