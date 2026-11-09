import {
  getHomeArtworkObjectFit,
  isRescalableArtworkFit,
  releaseArtwork,
  rescaleArtwork,
  resetArtworkRescaler,
  shouldRescaleHomeArtwork
} from "./tvPosterRescaler.js";
import { getTvArtworkPixelRatio } from "../../platform/tvRuntimePerformance.js";
import { registerSessionTeardownHandler } from "../../core/auth/sessionLifecycle.js";

// Poster surfaces outside Home. Home already has its own bounded hydrator, so
// these are only the screens that used to decode at the source size.
const ARTWORK_SELECTOR = [
  ".library-grid-poster-image",
  ".seeall-card-poster-image",
  ".detail-morelike-poster-image",
  ".search-result-poster"
].join(",");

// A transparent pixel keeps the card layout while the target-sized artwork is
// being prepared. The real source lives in data-artwork-src until then.
const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
const OBSERVER_MARGIN = "240px 0px";
// The worker fetches the source with CORS. TMDB is the host this app already
// uses for almost every poster and it allows the fetch; addon CDNs that do
// not answer CORS would make the fallback slower than loading the image
// directly, so they keep the browser path.
const RESCALABLE_IMAGE_HOSTS = new Set(["image.tmdb.org"]);

export function canRescaleArtworkHost(source) {
  try {
    const base = globalThis.location?.href || "http://localhost/";
    return RESCALABLE_IMAGE_HOSTS.has(new URL(String(source || ""), base).hostname);
  } catch (_) {
    return false;
  }
}

let started = false;
let observer = null;
let mutations = null;

function isHttpSource(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

export function isLazyArtworkImage(node) {
  return Boolean(
    node && node.nodeType === 1 && node.tagName === "IMG" && node.matches?.(ARTWORK_SELECTOR)
  );
}

function releaseImage(image) {
  if (!image || image.nodeType !== 1) return;
  const objectUrl = image.dataset?.artworkObjectUrl;
  if (objectUrl) {
    releaseArtwork(objectUrl);
    delete image.dataset.artworkObjectUrl;
  }
  observer?.unobserve?.(image);
}

function setArtworkSource(image, source) {
  const previous = image.dataset.artworkObjectUrl;
  if (previous && previous !== source) {
    releaseArtwork(previous);
    delete image.dataset.artworkObjectUrl;
  }
  if (String(source || "").startsWith("blob:")) {
    image.dataset.artworkObjectUrl = source;
  }
  image.src = source;
}

function hydrate(image) {
  const source = image?.dataset?.artworkSrc;
  if (!image || !source || !image.isConnected) return;
  if (image.dataset.artworkPending === "1") return;
  image.dataset.artworkPending = "1";
  const token = String(Number(image.dataset.artworkToken || 0) + 1);
  image.dataset.artworkToken = token;
  const rect = image.getBoundingClientRect();
  const fit = getHomeArtworkObjectFit(image);
  const ratio = getTvArtworkPixelRatio();
  const width = Math.round(Number(rect.width || 0) * ratio);
  const height = Math.round(Number(rect.height || 0) * ratio);
  const finish = () => {
    delete image.dataset.artworkPending;
  };
  if (!isRescalableArtworkFit(fit) || !(width > 0) || !(height > 0)) {
    finish();
    setArtworkSource(image, source);
    return;
  }
  const isStale = () =>
    !image.isConnected ||
    image.dataset.artworkToken !== token ||
    image.dataset.artworkSrc !== source;
  rescaleArtwork(source, { width, height, fit, priority: 0, isStale })
    .then((objectUrl) => {
      finish();
      if (isStale()) {
        if (objectUrl) releaseArtwork(objectUrl);
        return;
      }
      setArtworkSource(image, objectUrl || source);
    })
    .catch(() => {
      finish();
      if (!isStale()) setArtworkSource(image, source);
    });
}

function observeOrHydrate(image) {
  if (!observer) {
    hydrate(image);
    return;
  }
  observer.observe(image);
  // Some TV engines deliver the first IntersectionObserver callback late on
  // the first frame. Hydrate an already visible image now; the pending flag
  // keeps the observer callback from starting the same job twice.
  const rect = image.getBoundingClientRect();
  const visible =
    rect.bottom > 0 &&
    rect.top < (Number(globalThis.innerHeight) || 0) &&
    rect.right > 0 &&
    rect.left < (Number(globalThis.innerWidth) || 0);
  if (visible) hydrate(image);
}

function prepareImage(image) {
  if (!isLazyArtworkImage(image)) return;
  if (image.dataset.artworkLazy === "1") {
    // A prepared image can be moved by a screen re-render. Re-observe it
    // instead of leaving it as a transparent pixel after the previous
    // observer entry was released.
    if (image.dataset.artworkPending === "1" || image.dataset.artworkObjectUrl) return;
    const current = image.getAttribute("src") || "";
    if (current && current !== TRANSPARENT_PIXEL && !current.startsWith("blob:")) return;
    if (current.startsWith("blob:")) image.src = TRANSPARENT_PIXEL;
    observeOrHydrate(image);
    return;
  }
  // Home owns its own lazy index and already moves src to data-src.
  if (image.closest?.(".home-screen-shell")) return;
  // Discover already has an explicit data-src hydration path.
  if (image.hasAttribute("data-src")) return;
  const source = image.getAttribute("src");
  if (!isHttpSource(source)) return;
  if (!canRescaleArtworkHost(source)) return;
  image.dataset.artworkLazy = "1";
  image.dataset.artworkSrc = source;
  image.src = TRANSPARENT_PIXEL;
  observeOrHydrate(image);
}

function prepareTree(node) {
  if (!node || node.nodeType !== 1) return;
  if (node.closest?.(".home-screen-shell")) return;
  if (isLazyArtworkImage(node)) prepareImage(node);
  node.querySelectorAll?.(ARTWORK_SELECTOR).forEach(prepareImage);
}

function releaseTree(node) {
  if (!node || node.nodeType !== 1) return;
  if (node.tagName === "IMG") {
    Promise.resolve().then(() => {
      if (!node.isConnected) releaseImage(node);
    });
  }
  // A screen render often replaces a whole subtree. Wait one microtask so a
  // node that was only moved (removed and re-inserted in the same task) keeps
  // its artwork instead of having its blob url revoked.
  node.querySelectorAll?.("img[data-artwork-lazy]").forEach((image) => {
    Promise.resolve().then(() => {
      if (!image.isConnected) releaseImage(image);
    });
  });
}

function onIntersect(entries) {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    observer?.unobserve?.(entry.target);
    hydrate(entry.target);
  }
}

function onMutations(records) {
  for (const record of records) {
    record.addedNodes.forEach(prepareTree);
    record.removedNodes.forEach(releaseTree);
  }
}

/** Start the shared lazy artwork pass once per app run. */
export function startTvArtworkLazyLoader() {
  if (started || !shouldRescaleHomeArtwork()) return false;
  if (!globalThis.document?.body) return false;
  started = true;
  if (typeof globalThis.IntersectionObserver === "function") {
    observer = new globalThis.IntersectionObserver(onIntersect, {
      rootMargin: OBSERVER_MARGIN
    });
  }
  if (typeof globalThis.MutationObserver === "function") {
    mutations = new globalThis.MutationObserver(onMutations);
    mutations.observe(document.body, { childList: true, subtree: true });
  }
  prepareTree(document.body);
  return true;
}

export function stopTvArtworkLazyLoader() {
  observer?.disconnect?.();
  mutations?.disconnect?.();
  observer = null;
  mutations = null;
  started = false;
}

registerSessionTeardownHandler?.(() => {
  stopTvArtworkLazyLoader();
  resetArtworkRescaler();
});
