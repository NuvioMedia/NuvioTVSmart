import { hasMarkedFirstHomePaint, onFirstHomePaint } from "../core/diagnostics/bootTiming.js";

// When the session never reaches Home (profile picker, sign-in, a non-Home
// experience route) the deferred work still has to run; this bounds the wait.
const DEFAULT_FALLBACK_MS = 2500;

// Runs startup work that is not needed for the first Home paint once that
// paint has happened, or after `fallbackMs`, whichever comes first. The task
// runs on its own macrotask so the frame that painted Home is not extended.
export function runAfterFirstHomePaint(task, { fallbackMs = DEFAULT_FALLBACK_MS } = {}) {
  if (typeof task !== "function") {
    return;
  }
  let done = false;
  let timer = null;
  let unsubscribe = () => {};
  const run = () => {
    if (done) {
      return;
    }
    done = true;
    unsubscribe();
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    setTimeout(() => {
      try {
        task();
      } catch (error) {
        console.warn("Deferred startup task failed", error);
      }
    }, 0);
  };
  if (hasMarkedFirstHomePaint()) {
    run();
    return;
  }
  timer = setTimeout(run, Math.max(0, Number(fallbackMs) || 0));
  unsubscribe = onFirstHomePaint(run);
}
