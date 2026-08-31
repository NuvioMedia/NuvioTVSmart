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

function debugAssRender(stage, details = {}) {
  if (!globalThis.__NUVIO_DEBUG_ASS__) {
    return;
  }
  try {
    console.info(`[Nuvio ASS] ${stage}`, details);
  } catch (_) {
    // Debug logging must never affect playback.
  }
}

function hasRawAssControlText(container) {
  const text = String(container?.textContent || "");
  return (
    // Require the SSA field shape so legitimate cue text that merely starts
    /(?:^|\n)\s*(?:Dialogue|Comment)\s*:\s*(?:\d+|Marked\s*=\s*\d+)\s*,\s*\d+:\d{1,2}:\d{1,2}[.,]/i.test(
      text
    ) || /(?:^|\n)\s*\d+\s*,\s*\d+\s*,\s*(?:Onscreen\d*|Screen)\s*,/i.test(text)
  );
}

export function createAssRenderer({
  body,
  video,
  container,
  selectionToken,
  isCurrentSelection,
  resampling = "video_height",
  forceRafFrameLoop = false
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
      // ass.js constructs a ResizeObserver before its own cleanup handle is
      // available. Avoid a partial instance on older TV runtimes where the
      // library can load but ResizeObserver is missing.
      if (typeof globalThis.ResizeObserver !== "function") {
        return {
          ok: false,
          error: "ass-renderer-unsupported",
          detail: "ass.js requires ResizeObserver"
        };
      }
      try {
        const sourceBody = String(body)
          .replace(/^\uFEFF/, "")
          .replace(/\0/g, "");
        const hasEvents = /^\s*\[Events\]\s*$/im.test(sourceBody);
        const dialogueCount = (sourceBody.match(/^\s*Dialogue\s*:/gim) || []).length;
        debugAssRender("construct", {
          token,
          length: sourceBody.length,
          hasEvents,
          dialogueCount
        });
        // ass.js only parses Dialogue rows inside an [Events] section. A
        // headerless body would construct an empty renderer and report ok,
        // so reject it here and let the caller fall back to VTT.
        if (!hasEvents || !dialogueCount) {
          clearContainer(container);
          return {
            ok: false,
            error: "ass-renderer-empty-script",
            detail: "ASS body lacks an [Events] section with Dialogue rows"
          };
        }
        // webOS advertises requestVideoFrameCallback but never invokes it for
        // its video pipeline (measured 0 callbacks over 6s of playback while
        // requestAnimationFrame ticked normally), and ass.js schedules its
        // frame loop on rVFC when present — so cues paint once and freeze
        // (#844). Shadow the method while the constructor captures its frame
        // scheduler so ass.js binds requestAnimationFrame instead, then
        // restore the element.
        const shadowRvfc =
          forceRafFrameLoop &&
          typeof video.requestVideoFrameCallback === "function" &&
          !Object.prototype.hasOwnProperty.call(video, "requestVideoFrameCallback");
        if (shadowRvfc) {
          video.requestVideoFrameCallback = undefined;
        }
        try {
          instance = new AssConstructor(sourceBody, video, { container, resampling });
        } finally {
          if (shadowRvfc) {
            delete video.requestVideoFrameCallback;
          }
        }
        debugAssRender("constructed", {
          token,
          childCount: Number(container.childNodes?.length || 0),
          text: String(container.textContent || "").slice(0, 240)
        });
        if (hasRawAssControlText(container)) {
          instance.destroy?.();
          instance = null;
          clearContainer(container);
          return {
            ok: false,
            error: "ass-renderer-raw-control-text",
            detail: "ass.js exposed ASS control fields as visible text"
          };
        }
        // ass.js starts its frame loop only on a play/playing event. When a
        // subtitle is selected mid-playback the video is already playing, so
        // those events fired before this instance existed and the renderer
        // would freeze at its initial seek. Re-dispatch play (ass.js listens
        // to both play and playing, but the player binds only playing, so a
        // synthetic playing would trigger onPlaying side effects).
        if (video && typeof video.paused === "boolean" && !video.paused) {
          try {
            // Legacy webOS runtimes may lack the Event constructor; fall back
            // to document.createEvent like PlayerController.emitVideoEvent.
            let event = null;
            if (typeof Event === "function") {
              event = new Event("play");
            } else if (typeof document !== "undefined" && document.createEvent) {
              event = document.createEvent("Event");
              event.initEvent("play", false, false);
            }
            if (event) {
              video.dispatchEvent(event);
            }
          } catch (_) {
            // Best effort: playback is already advancing; nothing to sync.
          }
        }
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
