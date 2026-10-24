import { Environment } from "../../platform/environment.js";

// webOS Chromium decodes every animated <img> frame at full size and uploads it
// in the compositor commit path. With a row of collection GIFs on screen, every
// D-pad focus change waits behind those decodes (400-800ms per key on an LG G3).
// Supported cards render a static <img data-animated-src> instead, and the
// animation is drawn by a worker into an OffscreenCanvas layered above it.

const WORKER_PATH = "assets/runtime/animated-image-worker.js";
const CANVAS_CLASS = "home-poster-animated-canvas";
const FOCUS_ONLY_CANVAS_CLASS = "is-focus-gif";
// Pause all animation while the user is navigating so focus, scroll and hero
// updates get the CPU; resume once input settles.
const INPUT_HOLD_MS = 1000;
const SWEEP_INTERVAL_MS = 5000;
const DEFAULT_MAX_WIDTH = 960;
const DEFAULT_MAX_HEIGHT = 540;

const players = new Map();
const playersByCanvas = new WeakMap();
const failedSources = new Set();
let worker = null;
let workerUnavailable = false;
let nextPlayerId = 1;
let intersectionObserver = null;
let sweepTimer = 0;
let inputHoldTimer = 0;
let inputHeld = false;
let pageHidden = false;
let lastHeld = false;

function hasRuntimeSupport() {
  return (
    typeof Worker === "function" &&
    typeof ImageDecoder === "function" &&
    typeof OffscreenCanvas === "function" &&
    typeof createImageBitmap === "function" &&
    typeof IntersectionObserver === "function" &&
    typeof HTMLCanvasElement === "function" &&
    typeof HTMLCanvasElement.prototype.transferControlToOffscreen === "function"
  );
}

export function supportsAnimatedImageCanvas() {
  return !workerUnavailable && Environment.isWebOS() && hasRuntimeSupport();
}

export function shouldUseAnimatedImageCanvas(url) {
  const source = String(url || "").trim();
  return Boolean(source) && !failedSources.has(source) && supportsAnimatedImageCanvas();
}

function resolveWorkerUrl() {
  try {
    return new URL(WORKER_PATH, document.baseURI || location.href).toString();
  } catch (_) {
    return WORKER_PATH;
  }
}

function postHoldState() {
  const held = inputHeld || pageHidden;
  if (worker && held !== lastHeld) {
    lastHeld = held;
    worker.postMessage({ type: "hold", held });
  }
}

function handleInput() {
  inputHeld = true;
  postHoldState();
  clearTimeout(inputHoldTimer);
  inputHoldTimer = setTimeout(() => {
    inputHeld = false;
    postHoldState();
  }, INPUT_HOLD_MS);
}

function handleVisibilityChange() {
  pageHidden = Boolean(document.hidden);
  postHoldState();
}

function handleIntersections(entries) {
  entries.forEach((entry) => {
    const player = playersByCanvas.get(entry.target);
    if (player && worker) {
      worker.postMessage({ type: "visible", id: player.id, visible: entry.isIntersecting });
    }
  });
}

function handleWorkerMessage({ data = {} }) {
  if (data.type !== "error") {
    return;
  }
  const player = Array.from(players.values()).find((candidate) => candidate.id === data.id);
  if (player) {
    fallBackToNativeImage(player);
  }
}

function ensureWorker() {
  if (worker) {
    return worker;
  }
  try {
    worker = new Worker(resolveWorkerUrl());
  } catch (_) {
    workerUnavailable = true;
    return null;
  }
  worker.onmessage = handleWorkerMessage;
  worker.onerror = () => {
    workerUnavailable = true;
    Array.from(players.values()).forEach(fallBackToNativeImage);
    stopWorker();
  };
  intersectionObserver = new IntersectionObserver(handleIntersections);
  window.addEventListener("keydown", handleInput, true);
  window.addEventListener("wheel", handleInput, { capture: true, passive: true });
  document.addEventListener("visibilitychange", handleVisibilityChange);
  sweepTimer = setInterval(sweepDetachedPlayers, SWEEP_INTERVAL_MS);
  pageHidden = Boolean(document.hidden);
  lastHeld = false;
  postHoldState();
  return worker;
}

function stopWorker() {
  if (!worker) {
    return;
  }
  worker.terminate();
  worker = null;
  intersectionObserver?.disconnect();
  intersectionObserver = null;
  window.removeEventListener("keydown", handleInput, true);
  window.removeEventListener("wheel", handleInput, { capture: true });
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  clearInterval(sweepTimer);
  clearTimeout(inputHoldTimer);
  sweepTimer = 0;
  inputHoldTimer = 0;
  inputHeld = false;
}

function detachPlayer(player) {
  players.delete(player.image);
  intersectionObserver?.unobserve(player.canvas);
  player.canvas.remove();
  worker?.postMessage({ type: "detach", id: player.id });
  if (!players.size) {
    stopWorker();
  }
}

function restoreNativeImage(image, url, focusOnly) {
  image.removeAttribute("data-animated-src");
  if (focusOnly) {
    // The focus GIF overlay loads data-src itself while its card is focused.
    image.dataset.src = url;
    if (image.closest(".is-focus-gif-active")) {
      image.src = url;
    }
    return;
  }
  image.src = url;
}

function fallBackToNativeImage(player) {
  failedSources.add(player.url);
  detachPlayer(player);
  restoreNativeImage(player.image, player.url, player.focusOnly);
}

function sweepDetachedPlayers() {
  Array.from(players.values()).forEach((player) => {
    if (!player.image.isConnected || player.image.dataset.animatedSrc !== player.url) {
      detachPlayer(player);
    }
  });
}

function createPlayer(image) {
  const url = String(image.dataset.animatedSrc || "").trim();
  const focusOnly = image.dataset.animatedFocusOnly === "true";
  if (!shouldUseAnimatedImageCanvas(url) || !ensureWorker()) {
    restoreNativeImage(image, url, focusOnly);
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.className = focusOnly ? `${CANVAS_CLASS} ${FOCUS_ONLY_CANVAS_CLASS}` : CANVAS_CLASS;
  canvas.setAttribute("aria-hidden", "true");
  image.insertAdjacentElement("afterend", canvas);
  let offscreen;
  try {
    offscreen = canvas.transferControlToOffscreen();
  } catch (_) {
    canvas.remove();
    restoreNativeImage(image, url, focusOnly);
    return null;
  }
  const frame = image.parentElement || image;
  const pixelRatio = Math.max(1, Number(globalThis.devicePixelRatio) || 1);
  const player = { id: nextPlayerId++, image, canvas, url, focusOnly };
  players.set(image, player);
  playersByCanvas.set(canvas, player);
  worker.postMessage(
    {
      type: "attach",
      id: player.id,
      url: new URL(url, document.baseURI || location.href).toString(),
      canvas: offscreen,
      focusOnly,
      maxWidth: Math.round((frame.offsetWidth || DEFAULT_MAX_WIDTH) * pixelRatio),
      maxHeight: Math.round((frame.offsetHeight || DEFAULT_MAX_HEIGHT) * pixelRatio)
    },
    [offscreen]
  );
  intersectionObserver.observe(canvas);
  return player;
}

function getPlayer(image) {
  const player = players.get(image);
  if (player && player.url === image.dataset.animatedSrc && player.canvas.isConnected) {
    return player;
  }
  if (player) {
    detachPlayer(player);
  }
  return image.dataset.animatedSrc ? createPlayer(image) : null;
}

export function attachAnimatedImageCanvases(root) {
  if (!root?.querySelectorAll || !Environment.isWebOS()) {
    return;
  }
  sweepDetachedPlayers();
  root.querySelectorAll("img[data-animated-src]").forEach((image) => {
    if (image.dataset.animatedFocusOnly !== "true") {
      getPlayer(image);
    }
  });
}

// Returns false when the image has no canvas player, so the caller can use its
// native <img> path instead.
export function setAnimatedImageCanvasActive(image, active) {
  if (!(image instanceof HTMLImageElement) || !image.dataset.animatedSrc) {
    return false;
  }
  const player = active ? getPlayer(image) : players.get(image);
  if (!player) {
    // Inactive and never played, or restored to a native <img> just now.
    return !active;
  }
  worker?.postMessage({ type: "active", id: player.id, active: Boolean(active) });
  return true;
}

export function releaseAnimatedImageCanvases(root) {
  Array.from(players.values()).forEach((player) => {
    if (!root || root.contains(player.image) || !player.image.isConnected) {
      detachPlayer(player);
    }
  });
}
