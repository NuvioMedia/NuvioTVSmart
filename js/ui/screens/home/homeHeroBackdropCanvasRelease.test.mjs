import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const strip = (source) => source.replace(/^import [\s\S]*?;$/gm, "").replace(/^export /gm, "");

const helper03 = strip(
  await readFile(
    new URL("./homeScreenHelpers-03-animate-hero-backdrop-swap.js", import.meta.url),
    "utf8"
  )
);

test("animateHeroBackdropSwap zeroes backing store of removed canvases and aborts when disconnected", async () => {
  class ClassSet extends Set {
    remove(...names) {
      names.forEach((n) => this.delete(n));
    }
    toggle(n, f) {
      if (f == null) f = !this.has(n);
      if (f) this.add(n);
      else this.delete(n);
      return f;
    }
  }
  class FakeEl {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.classList = new ClassSet();
      this.attributes = {};
      this.style = { removeProperty() {}, setProperty() {} };
      this.parentElement = null;
      this.isConnected = true;
      this.width = 0;
      this.height = 0;
    }
    set className(v) {
      this.classList.clear();
      String(v)
        .split(" ")
        .filter(Boolean)
        .forEach((c) => this.classList.add(c));
    }
    getAttribute(k) {
      return this.attributes[k] ?? null;
    }
    setAttribute(k, v) {
      this.attributes[k] = String(v);
    }
    removeAttribute(k) {
      delete this.attributes[k];
    }
    cloneNode() {
      return new FakeEl(this.tagName);
    }
    getContext() {
      return { drawImage() {} };
    }
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
    }
    insertBefore(child, ref) {
      child.parentElement = this;
      this.children.splice(Math.max(0, this.children.indexOf(ref)), 0, child);
    }
    remove() {
      if (this.parentElement) {
        this.parentElement.children = this.parentElement.children.filter((n) => n !== this);
        this.parentElement = null;
      }
      this.isConnected = false;
    }
    querySelectorAll(sel) {
      const ghostsOnly = sel.includes("transition-ghost") && !sel.includes(":not");
      return this.children.filter((n) =>
        ghostsOnly
          ? n.classList.has("home-hero-backdrop-transition-ghost")
          : n.classList.has("home-hero-backdrop-canvas") &&
            !n.classList.has("home-hero-backdrop-transition-ghost")
      );
    }
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    }
  }
  class FakeImg extends FakeEl {}

  const createdCanvases = [];
  const frames = [];
  const timers = [];
  const flush = async () => {
    for (let step = 0; step < 6; step += 1) {
      await Promise.resolve();
      await Promise.resolve();
      frames.splice(0).forEach((cb) => cb());
      timers.splice(0).forEach((cb) => cb());
    }
  };
  const context = vm.createContext({
    HTMLImageElement: FakeImg,
    HOME_MODERN_HERO_BACKDROP_CROSSFADE_MS: 0,
    document: {
      createElement: (tag) => {
        const el = new FakeEl(tag);
        if (el.tagName === "CANVAS") createdCanvases.push(el);
        return el;
      }
    },
    requestAnimationFrame: (cb) => frames.push(cb),
    setTimeout: (cb) => timers.push(cb),
    preloadHeroBackdrop: () =>
      Promise.resolve({ loaded: true, bitmap: { width: 1920, height: 1080 } }),
    prepareHeroImageEnter: () => {}
  });
  vm.runInContext(helper03, context);

  const wrap = new FakeEl("div");
  const img = new FakeImg("img");
  img.setAttribute("src", "https://img/1.jpg");
  wrap.appendChild(img);

  context.animateHeroBackdropSwap(img, "https://img/2.jpg");
  await flush();
  assert.equal(createdCanvases.length, 1);
  const firstCanvas = createdCanvases[0];
  assert.equal(firstCanvas.width, 1920);

  // Swap to a 3rd backdrop, turning firstCanvas into a ghost then freeing it when finalized.
  context.animateHeroBackdropSwap(img, "https://img/3.jpg");
  await flush();
  assert.equal(firstCanvas.width, 0);
  assert.equal(firstCanvas.height, 0);

  // Disconnecting before preload resolves must abort cleanly without appending a new canvas.
  const imgDetached = new FakeImg("img");
  imgDetached.setAttribute("src", "https://img/1.jpg");
  wrap.appendChild(imgDetached);
  context.animateHeroBackdropSwap(imgDetached, "https://img/4.jpg");
  imgDetached.isConnected = false;
  await flush();
  assert.equal(createdCanvases.length, 2, "must not create canvas after backdrop disconnects");
});
