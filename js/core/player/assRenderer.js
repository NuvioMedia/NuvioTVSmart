import { loadAssSubtitleLib } from "./assSubtitleLoader.js";

/**
 * ass.js lifecycle adapter. The only module that touches the ass.js API:
 * - loads and validates the global ASS constructor;
 * - creates the instance with the raw body, video, container, resampling;
 * - converts milliseconds to ass.js delay seconds (positive delay = later,
 *   matching ass.js semantics where delay shifts subtitles forward in time);
 * - destroys the library instance and clears renderer-owned DOM;
 * - rejects stale activations when a newer selection token wins.
 */

function clearContainer(container) {
  if (!container) {
    return;
  }
  try {
    if (typeof container.replaceChildren === "function") {
      container.replaceChildren();
    } else {
      container.innerHTML = "";
    }
  } catch (_) {
    // Best effort.
  }
}

export function createAssRenderer({
  body,
  video,
  container,
  selectionToken,
  isCurrentSelection,
  resampling = "video_height"
}) {
  if (!body || !video || !container) {
    return { ok: false, error: "ass-renderer-missing-arguments" };
  }
  const token = Number(selectionToken || 0);
  const stale = () => (typeof isCurrentSelection === "function" ? !isCurrentSelection() : false);

  let instance = null;
  let destroyed = false;

  return {
    get active() {
      return !destroyed && !stale();
    },
    async init() {
      if (destroyed) {
        return { ok: false, error: "ass-renderer-destroyed" };
      }
      let AssConstructor;
      try {
        AssConstructor = await loadAssSubtitleLib();
      } catch (error) {
        return {
          ok: false,
          error: "ass-renderer-load-failed",
          detail: error?.message || String(error || "")
        };
      }
      if (typeof AssConstructor !== "function") {
        return {
          ok: false,
          error: "ass-renderer-load-failed",
          detail: "ass.js global ASS is not a constructor"
        };
      }
      if (destroyed || stale()) {
        return { ok: false, error: "ass-renderer-stale" };
      }
      try {
        instance = new AssConstructor(String(body), video, { container, resampling });
      } catch (error) {
        instance = null;
        clearContainer(container);
        return {
          ok: false,
          error: "ass-renderer-parse-failed",
          detail: error?.message || String(error || "")
        };
      }
      if (destroyed || stale()) {
        // A newer selection won while the constructor ran synchronously:
        // tear down the just-created instance so no listener or DOM survives.
        this.destroy();
        return { ok: false, error: "ass-renderer-stale" };
      }
      return { ok: true };
    },
    /** Delay in milliseconds; ass.js delay is seconds, positive = later. */
    setDelay(delayMs) {
      if (!instance || destroyed || stale()) {
        return false;
      }
      try {
        instance.delay = Number(delayMs || 0) / 1000;
        return true;
      } catch (_) {
        return false;
      }
    },
    show() {
      if (!instance || destroyed || stale()) {
        return;
      }
      try {
        instance.show();
      } catch (_) {
        // Best effort.
      }
    },
    hide() {
      if (!instance || destroyed) {
        return;
      }
      try {
        instance.hide();
      } catch (_) {
        // Best effort.
      }
    },
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      if (instance) {
        try {
          instance.destroy();
        } catch (_) {
          // Best effort: still clear renderer-owned DOM below.
        }
        instance = null;
      }
      clearContainer(container);
    },
    get token() {
      return token;
    }
  };
}
