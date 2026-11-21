import { getSubtitleVerticalOffsetVh } from "../../../core/player/subtitleVerticalOffset.js";

// The controls overlay fades out over 200ms (components-30.css). Subtitle clearance has to
// follow the fade, not the logical visibility flag, or subtitles jump while controls are still
// on screen.
export const CONTROLS_HIDE_TRANSITION_MS = 200;

export function keepControlsClearance({
  controlsVisible = false,
  hideUntil = 0,
  now = Date.now()
} = {}) {
  return Boolean(controlsVisible) || Number(now) < Number(hideUntil || 0);
}

// HTML bottom cues and capable ASS renderers receive selective placement.
// Authored positions and opaque native subtitle planes retain their coordinates.
const lastNoOverlayAssState = new WeakMap();

export function syncHtmlSubtitleClearance(screen) {
  const refs = screen.uiRefs;
  const root = refs?.root;
  if (!root?.style || typeof root.getBoundingClientRect !== "function") return;
  const controlsEnabled =
    !screen.subtitleDialogVisible &&
    keepControlsClearance({
      controlsVisible: screen.controlsVisible,
      hideUntil: screen.controlsHideUntil
    }) &&
    !refs.controlsOverlay?.classList.contains("modal-blocked");
  const isCandidate = (node, enabled) =>
    Boolean(!screen.subtitleDialogVisible && enabled && node && !node.classList.contains("hidden"));
  const candidates = [
    [refs.controlsBottom, controlsEnabled],
    [refs.skipIntro, true],
    [refs.nextEpisodeCard, true],
    [refs.seekOverlay, screen.seekOverlayVisible && !screen.controlsVisible]
  ].filter(([node, enabled]) => isCandidate(node, enabled));

  if (candidates.length === 0) {
    // Nothing overlaps the subtitle band, so the lift is 0 at any viewport size.
    if (root.style.getPropertyValue("--player-subtitle-clearance") !== "0px") {
      root.style.setProperty("--player-subtitle-clearance", "0px");
    }
    const renderer = screen.assSubtitleRenderer;
    if (typeof renderer?.setPlacement !== "function") {
      lastNoOverlayAssState.delete(screen);
      return;
    }
    const verticalOffsetVh = getSubtitleVerticalOffsetVh(
      screen.subtitleStyleSettings?.verticalOffset
    );
    // #playerUiRoot is inset:0 inside the fixed player surface, so its rect only
    // changes with the viewport; innerHeight is the cheap invalidation key.
    const winHeight = typeof globalThis.innerHeight === "number" ? globalThis.innerHeight : null;
    const prev = lastNoOverlayAssState.get(screen);
    if (
      prev &&
      prev.renderer === renderer &&
      prev.verticalOffsetVh === verticalOffsetVh &&
      prev.winHeight === winHeight
    ) {
      return;
    }
    const viewport = root.getBoundingClientRect();
    if (!(viewport.height > 0)) return;
    renderer.setPlacement({
      viewportBottom: viewport.bottom,
      overlayTop: null,
      userOffsetPx: -(viewport.height * verticalOffsetVh) / 100
    });
    lastNoOverlayAssState.set(screen, { renderer, verticalOffsetVh, winHeight });
    return;
  }

  lastNoOverlayAssState.delete(screen);
  const viewport = root.getBoundingClientRect();
  if (!(viewport.height > 0)) return;
  const gap = (viewport.height * 8) / 540;
  let clearance = 0;
  const include = (node) => {
    if (!node.getClientRects().length) return;
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return;
    const rect = node.getBoundingClientRect();
    if (rect.height > 0) clearance = Math.max(clearance, viewport.bottom - rect.top + gap);
  };
  candidates.forEach(([node]) => include(node));
  const bottom =
    (viewport.height *
      (8 - getSubtitleVerticalOffsetVh(screen.subtitleStyleSettings?.verticalOffset))) /
    100;
  const lift = Math.max(0, Math.min(viewport.height / 2, clearance) - bottom);
  const value = `${Math.round(lift)}px`;
  if (root.style.getPropertyValue("--player-subtitle-clearance") !== value)
    root.style.setProperty("--player-subtitle-clearance", value);
  screen.assSubtitleRenderer?.setPlacement?.({
    viewportBottom: viewport.bottom,
    overlayTop: clearance > 0 ? viewport.bottom - Math.min(viewport.height / 2, clearance) : null,
    userOffsetPx:
      -(
        viewport.height * getSubtitleVerticalOffsetVh(screen.subtitleStyleSettings?.verticalOffset)
      ) / 100
  });
}
