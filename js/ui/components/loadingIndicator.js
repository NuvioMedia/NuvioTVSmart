import { renderBrandWordmarkImage } from "./brandWordmark.js";
import { isModernTvProfile } from "../../platform/tvPerformancePolicy.js";
import { getTvRuntimePerformanceProfile } from "../../platform/tvRuntimePerformance.js";

let loadingIndicatorSequence = 0;

// Literal SVG stop colors also support TV engines without CSS variables.
// Theme changes update mounted gradients; new nodes use the resolved palette.
let loadingAccentColors = ["#f5f5f5"];

export function syncLoadingIndicatorPalette(palette) {
  const nextColors = String(palette["--accent-gradient"] || palette["--secondary-color"]).match(
    /#[0-9a-f]{6}/gi
  ) || ["#f5f5f5"];
  if (nextColors.join(",") !== loadingAccentColors.join(",")) {
    document.querySelectorAll(".home-loading-spinner.has-loader-sprite").forEach((node) => {
      node.classList.remove("has-loader-sprite");
      node.style.removeProperty("--loader-sprite");
    });
    if (loaderSprite?.url) URL.revokeObjectURL(loaderSprite.url);
    loaderSprite = null;
  }
  loadingAccentColors = nextColors;
  document.querySelectorAll(".nuvio-loading-gradient").forEach((gradient) => {
    while (gradient.firstChild) gradient.removeChild(gradient.firstChild);
    loadingAccentColors.forEach((color, index) => {
      const stop = document.createElementNS("http://www.w3.org/2000/svg", "stop");
      stop.setAttribute(
        "offset",
        loadingAccentColors.length === 1 ? 0 : index / (loadingAccentColors.length - 1)
      );
      stop.setAttribute("stop-color", color);
      gradient.appendChild(stop);
    });
  });
  scheduleLoaderSprite();
}

// Home mounts a large DOM and lays it out in one long task, so an animation
// that repaints stroke-dash data stalls exactly when the loader is visible.
// The same Android frames are pre-rendered into a strip and scrolled with a
// transform, which the compositor keeps running through that task.
const LOADER_SPRITE_SIZE = 96;
// Modern TVs get a 60 fps strip; constrained and legacy TVs get half the
// frames, which halves the decoded texture and still looks smooth on their
// slower panels.
const LOADER_SPRITE_FRAMES_MODERN = 120;
const LOADER_SPRITE_FRAMES_CONSTRAINED = 60;

let loaderSprite = null;
let loaderSpritePending = false;

function loadingIndicatorEase(value) {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  const x1 = 0.333;
  const y1 = 0;
  const x2 = 0.667;
  const y2 = 1;
  const x = (t) => 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
  const y = (t) => 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
  let low = 0;
  let high = 1;
  for (let index = 0; index < 40; index += 1) {
    const mid = (low + high) / 2;
    if (x(mid) < value) low = mid;
    else high = mid;
  }
  return y((low + high) / 2);
}

function drawLoaderSprite(colors, frames) {
  const size = LOADER_SPRITE_SIZE;
  const ratio = Math.min(2, Math.max(1, Number(globalThis.devicePixelRatio) || 1));
  const canvas = document.createElement("canvas");
  canvas.width = size * frames * ratio;
  canvas.height = size * ratio;
  const context = canvas.getContext("2d");
  if (!context || typeof canvas.toBlob !== "function") return Promise.resolve(null);
  context.scale(ratio, ratio);
  context.lineCap = "round";
  context.lineWidth = 50 * ((size * 0.75) / 350);
  const gradient = context.createLinearGradient(0, 0, size, size);
  colors.forEach((color, index) => {
    gradient.addColorStop(colors.length === 1 ? 0 : index / (colors.length - 1), color);
  });
  context.strokeStyle = gradient;
  const radius = 150 * ((size * 0.75) / 350);
  const center = size / 2;
  for (let index = 0; index < frames; index += 1) {
    const frame = (index / frames) * 60;
    const start = 99 * loadingIndicatorEase(Math.min(1, Math.max(0, (frame - 10) / 50)));
    const end = 1 + 99 * loadingIndicatorEase(Math.min(1, Math.max(0, frame / 50)));
    const startAngle = -90 + (frame / 60) * 363 + start * 3.6;
    const sweep = (end - start) * 3.6;
    context.save();
    context.translate(index * size, 0);
    context.beginPath();
    context.arc(
      center,
      center,
      radius,
      (startAngle * Math.PI) / 180,
      ((startAngle + sweep) * Math.PI) / 180
    );
    context.stroke();
    context.restore();
  }
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : null), "image/png");
  });
}

export function resolveLoaderSpriteDelay(node) {
  const arc = node?.querySelector?.(".nuvio-loading-indicator-arc");
  const current = Number(arc?.getAnimations?.()?.[0]?.currentTime || 0);
  return current > 0 ? `-${Math.round(current)}ms` : "0ms";
}

function applyLoaderSpriteToMounted() {
  if (!loaderSprite || typeof document === "undefined") return;
  document.querySelectorAll(".home-loading-spinner").forEach((node) => {
    node.classList.add("has-loader-sprite");
    node.classList.toggle("has-loader-sprite-60", loaderSprite.frames <= 60);
    node.style.setProperty("--loader-sprite", `url(${loaderSprite.url})`);
    // A strip that becomes ready mid-loader must continue from the frame the
    // SVG arc is already showing, not restart at frame 0.
    node.style.setProperty("--loader-sprite-delay", resolveLoaderSpriteDelay(node));
  });
}

export function loaderSpriteFramesFor(profile) {
  return isModernTvProfile(profile)
    ? LOADER_SPRITE_FRAMES_MODERN
    : LOADER_SPRITE_FRAMES_CONSTRAINED;
}

function scheduleLoaderSprite() {
  if (typeof window === "undefined" || loaderSpritePending) return;
  const profile = getTvRuntimePerformanceProfile();
  if (!profile?.isTvRuntime) return;
  const frames = loaderSpriteFramesFor(profile);
  const key = `${loadingAccentColors.join(",")}|${frames}`;
  if (loaderSprite?.key === key) {
    applyLoaderSpriteToMounted();
    return;
  }
  loaderSpritePending = true;
  const build = () => {
    loaderSpritePending = false;
    const currentKey = `${loadingAccentColors.join(",")}|${frames}`;
    void drawLoaderSprite(loadingAccentColors, frames).then((url) => {
      if (!url) return;
      if (currentKey !== `${loadingAccentColors.join(",")}|${frames}`) {
        URL.revokeObjectURL(url);
        return;
      }
      if (loaderSprite?.url) URL.revokeObjectURL(loaderSprite.url);
      loaderSprite = { url, key: currentKey, frames };
      applyLoaderSpriteToMounted();
    });
  };
  if (typeof globalThis.requestIdleCallback === "function") {
    globalThis.requestIdleCallback(build, { timeout: 2500 });
  } else {
    setTimeout(build, 1200);
  }
}

function getLoaderSprite(className) {
  if (!className.split(/\s+/).includes("home-loading-spinner")) return null;
  return loaderSprite || null;
}

function renderGradientStops() {
  return loadingAccentColors
    .map(
      (color, index) =>
        `<stop offset="${loadingAccentColors.length === 1 ? 0 : index / (loadingAccentColors.length - 1)}" stop-color="${color}"/>`
    )
    .join("");
}

function escapeAttribute(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderLogoLoadingMarkup(options = {}) {
  const className = String(options?.className || "").trim();
  const label = String(options?.label || "Loading").trim() || "Loading";
  return `
    <div class="app-loading-screen${className ? ` ${escapeAttribute(className)}` : ""}" aria-label="${escapeAttribute(label)}">
      ${renderBrandWordmarkImage({ className: "app-loading-logo" })}
    </div>
  `;
}

export function renderLoadingIndicator(options = {}) {
  const className = String(options?.className || "").trim();
  const label = String(options?.label || "").trim();
  const gradientId = `nuvio-loading-gradient-${++loadingIndicatorSequence}`;
  const color = String(options?.color || "").trim();
  const solidColor = /^#[0-9a-f]{6}$/i.test(color) ? color : null;
  const accessibilityAttribute = label
    ? `role="status" aria-label="${escapeAttribute(label)}"`
    : 'aria-hidden="true"';
  const sprite = getLoaderSprite(className);
  if (!sprite) scheduleLoaderSprite();
  const spriteClass = sprite
    ? ` has-loader-sprite${sprite.frames <= 60 ? " has-loader-sprite-60" : ""}`
    : "";
  const spriteStyle = sprite ? ` style="--loader-sprite: url(${escapeAttribute(sprite.url)})"` : "";

  return `
    <span class="nuvio-loading-indicator${className ? ` ${escapeAttribute(className)}` : ""}${spriteClass}" ${accessibilityAttribute}${spriteStyle}>
      <svg class="nuvio-loading-indicator-svg" viewBox="0 0 350 350" aria-hidden="true" focusable="false">
        <defs><linearGradient id="${gradientId}" class="nuvio-loading-gradient" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="350" y2="350">${renderGradientStops()}</linearGradient></defs>
        <circle class="nuvio-loading-indicator-arc" cx="175" cy="175" r="112.5" fill="none" stroke="${solidColor || `url(#${gradientId})`}" stroke-width="37.5" stroke-linecap="round"/>
      </svg>
    </span>
  `;
}

export function createLoadingIndicator(text = "Loading...") {
  const node = document.createElement("div");
  node.className = "card";
  node.innerHTML = `
    ${renderLoadingIndicator({ label: text })}
    <p>${text}</p>
  `;
  return node;
}
