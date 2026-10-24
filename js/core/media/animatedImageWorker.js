// Plays animated collection artwork (GIF/WebP/APNG) into transferred OffscreenCanvas
// surfaces. webOS Chromium decodes and uploads every <img> GIF frame in the compositor
// commit path, so a few large GIFs hold every focus move behind their next decode.
// Frames decoded here reach the screen through the canvas surface instead.

const MIN_FRAME_DELAY_MS = 10;
const CLAMPED_FRAME_DELAY_MS = 100;
const MAX_SKIPPED_DRAWS = 6;
const MAX_LATE_RESYNC_MS = 1000;

const players = new Map();
let held = false;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function frameDelayMs(frame) {
  // Match Chromium's <img> timing: 0-10ms GIF delays play at 100ms.
  const ms = Number(frame?.duration || 0) / 1000;
  return ms > MIN_FRAME_DELAY_MS ? ms : CLAMPED_FRAME_DELAY_MS;
}

function inferImageType(url, contentType) {
  const type = String(contentType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (type.startsWith("image/")) {
    return type;
  }
  const path = String(url || "")
    .split(/[?#]/)[0]
    .toLowerCase();
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".png") || path.endsWith(".apng")) return "image/png";
  if (path.endsWith(".avif")) return "image/avif";
  return "image/gif";
}

function shouldPlay(player) {
  return !held && !player.closed && player.visible && player.active;
}

function release(player) {
  player.closed = true;
  try {
    player.decoder?.close();
  } catch (_) {}
  player.decoder = null;
  players.delete(player.id);
}

async function load(player) {
  const response = await fetch(player.url, { credentials: "omit" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const type = inferImageType(player.url, response.headers.get("content-type"));
  if (!(await ImageDecoder.isTypeSupported(type))) {
    throw new Error(`Unsupported image type ${type}`);
  }
  const data = await response.arrayBuffer();
  if (player.closed) {
    return;
  }
  const decoder = new ImageDecoder({ data, type });
  player.decoder = decoder;
  await decoder.tracks.ready;
  await decoder.completed;
  const track = decoder.tracks.selectedTrack;
  player.frameCount = Math.max(1, Number(track?.frameCount || 1));
  const repetitionCount = Number(track?.repetitionCount);
  player.maxLoops = Number.isFinite(repetitionCount) ? repetitionCount + 1 : Infinity;
  player.context = player.canvas.getContext("2d");
}

function sizeCanvas(player, frame) {
  const width = Number(frame.displayWidth || frame.codedWidth || 0);
  const height = Number(frame.displayHeight || frame.codedHeight || 0);
  if (!width || !height) {
    return;
  }
  // Never upscale the backing store; the card CSS stretches the canvas like the <img>.
  const scale = Math.min(1, player.maxWidth / width, player.maxHeight / height);
  player.canvas.width = Math.max(1, Math.round(width * scale));
  player.canvas.height = Math.max(1, Math.round(height * scale));
  player.sized = true;
}

async function draw(player, frame) {
  if (!player.sized) {
    sizeCanvas(player, frame);
  }
  // Scaling a VideoFrame directly takes a CPU path (~130ms for 1280x720 on LG);
  // an ImageBitmap is scaled by the GPU.
  const bitmap = await createImageBitmap(frame);
  try {
    player.context.drawImage(bitmap, 0, 0, player.canvas.width, player.canvas.height);
  } finally {
    bitmap.close();
  }
}

async function run(player) {
  if (player.running) {
    return;
  }
  player.running = true;
  try {
    if (!player.decoder) {
      await load(player);
    }
    let due = performance.now();
    let skipped = 0;
    while (shouldPlay(player) && player.loops < player.maxLoops) {
      const { image } = await player.decoder.decode({ frameIndex: player.index });
      try {
        // Paused, rewound or detached while decoding: keep the canvas as it was.
        if (!shouldPlay(player)) {
          break;
        }
        due += frameDelayMs(image);
        // GIF frames build on each other, so decoding cannot skip ahead. When
        // decoding falls behind, keep time by drawing fewer of the decoded frames.
        if (performance.now() <= due || skipped >= MAX_SKIPPED_DRAWS || !player.drawn) {
          await draw(player, image);
          player.drawn = true;
          skipped = 0;
        } else {
          skipped += 1;
        }
      } finally {
        image.close();
      }
      player.index += 1;
      if (player.index >= player.frameCount) {
        player.index = 0;
        player.loops += 1;
      }
      const delay = due - performance.now();
      if (delay > 0) {
        await wait(delay);
      } else if (delay < -MAX_LATE_RESYNC_MS) {
        due = performance.now();
      }
    }
  } catch (error) {
    if (!player.closed) {
      postMessage({ type: "error", id: player.id, message: String(error?.message || error) });
      release(player);
    }
  } finally {
    player.running = false;
  }
  if (shouldPlay(player) && player.loops < player.maxLoops) {
    run(player);
  }
}

function rewind(player) {
  player.index = 0;
  player.loops = 0;
  if (player.context && player.drawn) {
    player.context.clearRect(0, 0, player.canvas.width, player.canvas.height);
  }
  player.drawn = false;
}

function resumeAll() {
  players.forEach((player) => {
    if (shouldPlay(player)) {
      run(player);
    }
  });
}

self.onmessage = ({ data = {} }) => {
  const player = players.get(data.id);
  switch (data.type) {
    case "attach":
      players.set(data.id, {
        id: data.id,
        url: data.url,
        canvas: data.canvas,
        maxWidth: Math.max(1, Number(data.maxWidth) || 960),
        maxHeight: Math.max(1, Number(data.maxHeight) || 540),
        visible: false,
        active: !data.focusOnly,
        index: 0,
        loops: 0,
        maxLoops: Infinity
      });
      break;
    case "visible":
      if (player) {
        player.visible = Boolean(data.visible);
        if (shouldPlay(player)) run(player);
      }
      break;
    case "active":
      if (player) {
        player.active = Boolean(data.active);
        if (!player.active) rewind(player);
        else if (shouldPlay(player)) run(player);
      }
      break;
    case "hold":
      held = Boolean(data.held);
      if (!held) resumeAll();
      break;
    case "detach":
      if (player) release(player);
      break;
    default:
      break;
  }
};
