import { isAmbientTrailerPlaying } from "./ambientPlaybackPolicy.js";
import { WebOSPlayerExtensions } from "../../platform/webos/webosPlayerExtensions.js";
import { Platform } from "../../platform/index.js";
import { AmbientModeStore } from "../../data/local/ambientModeStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { Router } from "../navigation/routerState.js";
import { loadAmbientSlides } from "./ambientCatalogs.js";

export const AMBIENT_MOTIONS = [
  [1, 1.06, 0, 0, 0, 0],
  [1.07, 1.01, 0, 0, 0, 0],
  [1.06, 1.06, -0.025, 0.025, 0, 0],
  [1.06, 1.06, 0.025, -0.025, 0, 0],
  [1.06, 1.06, 0, 0, 0.02, -0.02],
  [1.02, 1.08, 0, -0.025, 0, -0.02],
  [1.02, 1.08, 0, 0.025, 0, 0.02]
];
const BLOCKED_ROUTES = new Set([
  "player",
  "profileSelection",
  "account",
  "experienceModeSelection",
  "essentialAddonSetup",
  "authQrSignIn",
  "authSignIn",
  "serverConnection"
]);
const now = () => globalThis.performance?.now?.() ?? Date.now();
function shuffled(values) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
function loadImage(url, signal) {
  return new Promise((resolve) => {
    if (!url || signal.aborted) return resolve(null);
    const image = new Image();
    let timer;
    const finish = (result) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      image.onload = null;
      image.onerror = null;
      resolve(result);
    };
    const cancel = () => {
      image.src = "";
      finish(null);
    };
    image.onload = () => finish(image.naturalWidth > 0 ? image : null);
    image.onerror = () => finish(null);
    signal.addEventListener("abort", cancel, { once: true });
    timer = setTimeout(cancel, 10000);
    image.src = url;
  });
}
export const AmbientMode = {
  showing: false,
  slides: [],
  generation: 0,
  lastInteraction: 0,
  swallowedKey: null,
  start() {
    if (this.started) return;
    this.started = true;
    this.lastInteraction = now();
    window.addEventListener("keydown", (event) => this.key(event, false), true);
    window.addEventListener("keyup", (event) => this.key(event, true), true);
    for (const type of ["pointerdown", "mousedown", "click", "wheel", "touchstart"])
      document.addEventListener(
        type,
        (event) => {
          this.lastInteraction = now();
          if (this.showing) {
            this.dismiss();
            this.pointerSwallowUntil = now() + 500;
          }
          if (now() < (this.pointerSwallowUntil || 0)) {
            event.preventDefault();
            event.stopImmediatePropagation();
          }
        },
        { capture: true, passive: false }
      );
    document.addEventListener(
      "mousemove",
      () => {
        if (!this.showing) this.lastInteraction = now();
      },
      true
    );
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.dismiss();
      this.lastInteraction = now();
    });
    this.interval = setInterval(() => this.tick(), 1000);
    this.tick();
  },
  key(event, up) {
    this.lastInteraction = now();
    const code = event.keyCode || event.key;
    if ((this.swallowedKey === code && (up || event.repeat)) || (!up && this.showing)) {
      this.swallowedKey = up ? null : code;
      this.dismiss();
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    this.swallowedKey = null;
  },
  allowed(settings) {
    const route = Router.getCurrent();
    return (
      settings.enabled &&
      route &&
      !BLOCKED_ROUTES.has(route) &&
      !this.trailerPlaying &&
      !document.hidden
    );
  },
  tick() {
    const route = Router.getCurrent();
    const trailerPlaying = isAmbientTrailerPlaying(Router.getCurrentScreen?.());
    if (route !== this.idleRoute || trailerPlaying || this.trailerPlaying !== trailerPlaying) {
      // A completed/paused trailer starts a fresh idle period, as on Android.
      this.lastInteraction = now();
    }
    this.idleRoute = route;
    this.trailerPlaying = trailerPlaying;
    const settings = AmbientModeStore.get();
    const signature = JSON.stringify([ProfileManager.getActiveProfileId(), settings]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.generation++;
      this.controller?.abort();
      this.loadingSignature = null;
      this.slides = [];
      this.loadedAt = 0;
      clearTimeout(this.preload);
      this.dismiss();
      if (settings.enabled)
        this.preload = setTimeout(() => {
          void this.refresh();
        }, 20000);
    }
    if (!this.allowed(settings)) {
      if (this.showing) this.dismiss();
      return;
    }
    if (!this.showing && now() - this.lastInteraction >= settings.timeoutMinutes * 60000)
      this.show();
  },
  async refresh() {
    const signature = this.signature;
    const generation = this.generation;
    if (this.loadingSignature === signature) return;
    this.controller?.abort();
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    this.controller = controller;
    this.loadingSignature = signature;
    try {
      const slides = await loadAmbientSlides(
        AmbientModeStore.get().catalogKeys,
        controller?.signal
      );
      if (
        this.generation !== generation ||
        this.signature !== signature ||
        controller?.signal.aborted
      )
        return;
      if (slides.length || this.loadedSignature !== signature) this.slides = shuffled(slides);
      this.loadedSignature = signature;
      this.loadedAt = now();
    } catch (_) {
      /* Keep the last successful selection on transient failure. */
    } finally {
      if (this.generation === generation && this.controller === controller)
        this.loadingSignature = null;
    }
  },
  show() {
    if (this.showing) return;
    this.showing = true;
    if (Platform.isWebOS())
      WebOSPlayerExtensions.startAmbientKeepAwake(() => this.showing && !document.hidden);
    const screen = Router.getCurrentScreen?.();
    screen?.stopTrailerPlayback?.();
    screen?.cancelFocusedPosterFlow?.();
    screen?.clearFocusedPosterFlowState?.();
    for (const layer of screen?.container?.querySelectorAll?.(
      ".home-trailer-layer, .home-hero-trailer-layer, .home-poster-trailer-layer"
    ) || [])
      screen?.clearTrailerLayer?.(layer);
    if (typeof screen?.dismissDialogsForAmbient === "function") screen.dismissDialogsForAmbient();
    else {
      screen?.closeOptionDialog?.();
      screen?.closeTextDialog?.();
    }
    // Ask owning dialogs to close themselves, preserving their own focus/state cleanup.
    document.dispatchEvent(new CustomEvent("nuvio:ambient-shown"));
    this.previousScreen = screen;
    this.previousProfileId = ProfileManager.getActiveProfileId();
    this.previousFocus = document.activeElement;
    const root = document.createElement("div");
    root.className = "ambient-mode";
    root.setAttribute("role", "presentation");
    document.body.appendChild(root);
    this.root = root;
    if (
      this.loadedSignature !== this.signature ||
      now() - this.loadedAt > 1800000 ||
      !this.slides.length
    )
      void this.refresh();
    else this.slides = shuffled(this.slides);
    // Image loading only needs DOM cancellation events, available on older TV engines too.
    this.slideSignal = document.createDocumentFragment();
    this.slideSignal.aborted = false;
    this.index = 0;
    this.misses = 0;
    void this.nextSlide(this.slideSignal);
  },
  async nextSlide(signal) {
    if (signal.aborted || !this.showing) return;
    if (!this.slides.length) {
      this.slideTimer = setTimeout(() => {
        void this.nextSlide(signal);
      }, 500);
      return;
    }
    const slide = this.slides[this.index++ % this.slides.length];
    const [backdrop, logo] = await Promise.all([
      loadImage(slide.backdropUrl, signal),
      loadImage(slide.logoUrl, signal)
    ]);
    if (signal.aborted || !this.showing) return;
    if (!backdrop) {
      this.misses++;
      const delay = this.misses >= this.slides.length ? 15000 : 0;
      if (delay) this.misses = 0;
      this.slideTimer = setTimeout(() => {
        void this.nextSlide(signal);
      }, delay);
      return;
    }
    this.misses = 0;
    const motions = AMBIENT_MOTIONS.filter((motion) => motion !== this.motion);
    this.motion = motions[Math.floor(Math.random() * motions.length)];
    const [a, b, x, y, u, v] = this.motion;
    const stage = document.createElement("div");
    stage.className = "ambient-slide";
    stage.style.setProperty("--ambient-from", `translate(${x * 100}%,${u * 100}%) scale(${a})`);
    stage.style.setProperty("--ambient-to", `translate(${y * 100}%,${v * 100}%) scale(${b})`);
    backdrop.className = "ambient-backdrop";
    stage.appendChild(backdrop);
    const shade = document.createElement("div");
    shade.className = "ambient-shade";
    stage.appendChild(shade);
    const copy = document.createElement("div");
    copy.className = "ambient-copy";
    const title = logo || document.createElement("div");
    title.className = logo ? "ambient-logo ambient-title" : "ambient-title";
    if (!logo) title.textContent = slide.title;
    else title.alt = slide.title;
    copy.appendChild(title);
    if (slide.genres.length) {
      const genres = document.createElement("div");
      genres.className = "ambient-genres";
      genres.textContent = slide.genres.join("  •  ");
      copy.appendChild(genres);
    }
    stage.appendChild(copy);
    this.root.textContent = "";
    this.root.appendChild(stage);
    this.slideTimer = setTimeout(() => {
      void this.nextSlide(signal);
    }, 13250);
  },
  dismiss() {
    if (Platform.isWebOS()) WebOSPlayerExtensions.stopAmbientKeepAwake();
    if (!this.showing) return;
    this.showing = false;
    this.lastInteraction = now();
    if (this.slideSignal) {
      this.slideSignal.aborted = true;
      this.slideSignal.dispatchEvent(new Event("abort"));
      this.slideSignal = null;
    }
    clearTimeout(this.slideTimer);
    this.root?.remove();
    this.root = null;
    const canRestoreFocus =
      Router.getCurrentScreen?.() === this.previousScreen &&
      ProfileManager.getActiveProfileId() === this.previousProfileId;
    if (
      canRestoreFocus &&
      this.previousFocus?.isConnected &&
      this.previousFocus !== document.body &&
      this.previousFocus !== document.documentElement
    ) {
      try {
        this.previousFocus.focus({ preventScroll: true });
      } catch (_) {
        this.previousFocus.focus();
      }
    } else if (canRestoreFocus) {
      this.previousScreen?.applyFocus?.();
    }
    this.previousFocus = null;
    this.previousScreen = null;
    this.previousProfileId = null;
  }
};
