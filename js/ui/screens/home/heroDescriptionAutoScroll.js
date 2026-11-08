// Kodi-style vertical scrolling for Home hero descriptions that overflow their
// clamped box. Mirrors Android AutoScrollingText: start delay, constant speed,
// end pause, quick return, a few cycles, and edge fades instead of an ellipsis.

export const HERO_AUTOSCROLL_START_DELAY_MS = 3000;
export const HERO_AUTOSCROLL_END_PAUSE_MS = 3000;
export const HERO_AUTOSCROLL_RETURN_DURATION_MS = 600;
export const HERO_AUTOSCROLL_MAX_CYCLES = 3;
export const HERO_AUTOSCROLL_FADE_FRACTION = 0.18;
export const HERO_AUTOSCROLL_SPEED_DP_PER_SECOND = 12;

export function buildHeroDescriptionScrollPlan({
  contentHeight = 0,
  viewportHeight = 0,
  pixelsPerSecond = HERO_AUTOSCROLL_SPEED_DP_PER_SECOND
} = {}) {
  const content = Number(contentHeight);
  const viewport = Number(viewportHeight);
  const speed = Number(pixelsPerSecond);
  if (!Number.isFinite(content) || !Number.isFinite(viewport) || !Number.isFinite(speed)) {
    return null;
  }
  const distance = content - viewport;
  if (distance <= 1 || viewport <= 0 || speed <= 0) {
    return null;
  }
  return {
    distance,
    durationMs: Math.max(1, Math.round((distance / speed) * 1000)),
    startDelayMs: HERO_AUTOSCROLL_START_DELAY_MS,
    endPauseMs: HERO_AUTOSCROLL_END_PAUSE_MS,
    returnDurationMs: HERO_AUTOSCROLL_RETURN_DURATION_MS,
    cycles: HERO_AUTOSCROLL_MAX_CYCLES,
    fadeFraction: HERO_AUTOSCROLL_FADE_FRACTION
  };
}

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function requestFrame(callback) {
  if (typeof globalThis.requestAnimationFrame === "function") {
    return globalThis.requestAnimationFrame(callback);
  }
  return setTimeout(() => callback(now()), 16);
}

function cancelFrame(id) {
  if (typeof globalThis.cancelAnimationFrame === "function") {
    globalThis.cancelAnimationFrame(id);
  } else {
    clearTimeout(id);
  }
}

export function createHeroDescriptionAutoScroller({
  isPaused = () => false,
  onHoldChange = () => {}
} = {}) {
  let state = null;
  let token = 0;

  function clearMask(node) {
    if (!node) {
      return;
    }
    node.style.maskImage = "";
    node.style.webkitMaskImage = "";
  }

  function setMask(node, offset, plan) {
    const fade = Math.max(1, state.viewportHeight * plan.fadeFraction);
    const topAlpha = Math.min(offset, fade) / fade;
    const bottomAlpha = Math.min(plan.distance - offset, fade) / fade;
    const top = topAlpha > 0 ? `rgba(0,0,0,${1 - topAlpha}) 0px, #000 ${fade}px` : "#000 0px";
    const bottom =
      bottomAlpha > 0
        ? `#000 calc(100% - ${fade}px), rgba(0,0,0,${1 - bottomAlpha}) 100%`
        : "#000 100%";
    const mask = `linear-gradient(to bottom, ${top}, ${bottom})`;
    node.style.maskImage = mask;
    node.style.webkitMaskImage = mask;
  }

  function setOffset(offset) {
    if (!state?.track) {
      return;
    }
    state.offset = offset;
    state.track.style.transform = `translateY(${-offset}px)`;
    setMask(state.node, offset, state.plan);
  }

  function stopAnimation() {
    if (state?.frame) {
      cancelFrame(state.frame);
      state.frame = null;
    }
    if (state?.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }

  function reset(removeWrapper = false) {
    token += 1;
    stopAnimation();
    const current = state;
    state = null;
    if (!current) {
      onHoldChange(false);
      return;
    }
    onHoldChange(false);
    const { node, track } = current;
    if (node) {
      node.classList.remove("hero-description-autoscroll");
      node.style.height = "";
      clearMask(node);
    }
    if (track) {
      track.style.transform = "";
      track.style.willChange = "";
      if (removeWrapper && track.parentNode === node) {
        const text = track.textContent || "";
        node.textContent = text;
      }
    }
  }

  function waitWhilePaused(run) {
    const localToken = token;
    if (state?.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    if (!isPaused()) {
      run();
      return;
    }
    state.timer = setTimeout(() => {
      if (token !== localToken || !state) {
        return;
      }
      state.timer = null;
      if (isPaused()) {
        waitWhilePaused(run);
      } else {
        // Android resets to the top when a paused description resumes.
        setOffset(0);
        state.cycle = 0;
        state.phase = "delay";
        state.phaseStart = now() + state.plan.startDelayMs;
        state.frame = requestFrame(tick);
      }
    }, 250);
  }

  function tick(timestamp) {
    if (!state) {
      return;
    }
    state.frame = null;
    if (isPaused()) {
      waitWhilePaused(() => {
        if (state) {
          state.frame = requestFrame(tick);
        }
      });
      return;
    }
    const time = Number.isFinite(timestamp) ? timestamp : now();
    const elapsed = Math.max(0, time - state.phaseStart);
    if (state.phase === "delay") {
      if (elapsed >= state.plan.startDelayMs) {
        state.phase = "scroll";
        state.phaseStart = time;
        if (state.cycle === 0) {
          onHoldChange(true);
        }
      }
      state.frame = requestFrame(tick);
      return;
    }
    if (state.phase === "scroll") {
      const progress = Math.min(1, elapsed / state.plan.durationMs);
      setOffset(state.plan.distance * progress);
      if (progress >= 1) {
        state.phase = "endPause";
        state.phaseStart = time;
        if (state.cycle === 0) {
          onHoldChange(false);
        }
      }
      state.frame = requestFrame(tick);
      return;
    }
    if (state.phase === "endPause") {
      if (elapsed >= state.plan.endPauseMs) {
        state.phase = "return";
        state.phaseStart = time;
      }
      state.frame = requestFrame(tick);
      return;
    }
    if (state.phase === "return") {
      const progress = Math.min(1, elapsed / state.plan.returnDurationMs);
      setOffset(state.plan.distance * (1 - progress));
      if (progress >= 1) {
        setOffset(0);
        state.cycle += 1;
        if (state.cycle >= state.plan.cycles) {
          stopAnimation();
          return;
        }
        state.phase = "delay";
        state.phaseStart = now() + state.plan.startDelayMs;
      }
      state.frame = requestFrame(tick);
      return;
    }
  }

  return {
    apply(node, enabled) {
      if (!node || !enabled) {
        reset(true);
        return false;
      }
      const text = String(node.textContent || "").trim();
      if (!text) {
        reset(true);
        return false;
      }
      const viewportHeight = node.clientHeight;
      if (!viewportHeight) {
        reset(true);
        return false;
      }
      reset(false);
      const localToken = token;

      let track = null;
      if (
        node.childNodes.length === 1 &&
        node.firstElementChild?.classList?.contains("hero-description-track")
      ) {
        track = node.firstElementChild;
      } else {
        track = node.ownerDocument.createElement("span");
        track.className = "hero-description-track";
        while (node.firstChild) {
          track.appendChild(node.firstChild);
        }
        node.appendChild(track);
      }
      node.classList.add("hero-description-autoscroll");
      node.style.height = `${viewportHeight}px`;
      const plan = buildHeroDescriptionScrollPlan({
        contentHeight: track.scrollHeight,
        viewportHeight,
        pixelsPerSecond:
          HERO_AUTOSCROLL_SPEED_DP_PER_SECOND *
          Math.max(1, Number(globalThis.devicePixelRatio) || 1)
      });
      if (!plan) {
        node.classList.remove("hero-description-autoscroll");
        node.style.height = "";
        clearMask(node);
        if (track.parentNode === node) {
          node.textContent = track.textContent || text;
        }
        return false;
      }
      state = {
        node,
        track,
        plan,
        viewportHeight,
        offset: 0,
        phase: "delay",
        phaseStart: now() + plan.startDelayMs,
        cycle: 0,
        frame: null,
        timer: null
      };
      setOffset(0);
      state.frame = requestFrame(tick);
      void localToken;
      return true;
    },
    stop() {
      reset(true);
    }
  };
}
