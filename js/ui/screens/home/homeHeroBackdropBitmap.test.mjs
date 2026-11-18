import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// Drives the real hero backdrop swap against a minimal DOM: Tizen's bitmap
// layer must keep the Android crossfade and fall back to the <img> layer.
const source = (await readFile(new URL("./homeScreenHelpers-03-animate-hero-backdrop-swap.js", import.meta.url), "utf8"))
  .replace(/^import [\s\S]*?";$/gm, "")
  .replace(/^export /gm, "");

const GHOST = "home-hero-backdrop-transition-ghost";

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.attributes = {};
    this.classList = new Set();
    this.classList.contains = this.classList.has;
    this.classList.remove = (...names) => names.forEach((name) => this.classList.delete(name));
    const add = this.classList.add.bind(this.classList);
    this.classList.add = (...names) => names.forEach((name) => add(name));
    const props = {};
    this.style = {
      getPropertyValue: (name) => props[name] || "",
      getPropertyPriority: () => "",
      setProperty: (name, value) => (props[name] = value),
      removeProperty: (name) => delete props[name],
      props
    };
    this.children = [];
    this.parentElement = null;
    this.offsetWidth = 0;
  }
  set className(value) {
    this.classList.clear();
    value.split(" ").forEach((name) => this.classList.add(name));
  }
  getAttribute(name) {
    return name in this.attributes ? this.attributes[name] : null;
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  removeAttribute(name) {
    delete this.attributes[name];
  }
  cloneNode() {
    const clone = new this.constructor(this.tagName);
    Object.assign(clone.attributes, this.attributes);
    this.classList.forEach((name) => clone.classList.add(name));
    return clone;
  }
  getContext() {
    return { drawImage: (bitmap) => (this.drawn = bitmap) };
  }
  appendChild(child) {
    child.remove?.();
    child.parentElement = this;
    this.children.push(child);
  }
  insertBefore(child, reference) {
    child.parentElement = this;
    this.children.splice(Math.max(0, this.children.indexOf(reference)), 0, child);
  }
  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((node) => node !== this);
      this.parentElement = null;
    }
  }
  querySelectorAll(selector) {
    const ghostsOnly = selector === `.${GHOST}`;
    return this.children.filter((node) =>
      ghostsOnly ? node.classList.has(GHOST) : node.classList.has("home-hero-backdrop-canvas") && !node.classList.has(GHOST)
    );
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}
class FakeImage extends FakeElement {}

function setup(results) {
  const context = vm.createContext({
    HTMLImageElement: FakeImage,
    HOME_MODERN_HERO_BACKDROP_CROSSFADE_MS: 0,
    document: { createElement: (tag) => new FakeElement(tag) },
    requestAnimationFrame: (callback) => setTimeout(callback, 0),
    setTimeout,
    preloadHeroBackdrop: (src) => Promise.resolve(results[src]),
    prepareHeroImageEnter: (node, enterClass) => {
      node.classList.remove("is-visible");
      node.classList.add(enterClass);
    }
  });
  vm.runInContext(source, context);
  const wrap = new FakeElement("div");
  const image = new FakeImage("img");
  image.className = "home-hero-backdrop";
  image.setAttribute("src", "https://img/a.webp");
  wrap.appendChild(image);
  return { swap: context.animateHeroBackdropSwap, wrap, image };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

test("bitmap backdrops crossfade over the previous artwork and keep the <img> as anchor", async () => {
  const bitmapB = { width: 1920, height: 1080 };
  const bitmapC = { width: 1920, height: 1080 };
  const { swap, wrap, image } = setup({
    "https://img/b.webp": { loaded: true, bitmap: bitmapB },
    "https://img/c.webp": { loaded: true, bitmap: bitmapC }
  });

  swap(image, "https://img/b.webp");
  await new Promise((resolve) => setTimeout(resolve, 0));
  const [ghost, , canvasB] = wrap.children;
  assert.ok(ghost.classList.has(GHOST), "previous <img> artwork fades out underneath");
  assert.equal(canvasB.drawn, bitmapB);
  assert.equal(image.getAttribute("src"), null, "full-size <img> decode is released");
  assert.equal(image.style.props.visibility, "hidden");
  await settle();
  assert.deepEqual(wrap.children, [image, canvasB], "ghost removed after the crossfade");
  assert.ok(!canvasB.classList.has("home-hero-backdrop-transition-enter"));

  swap(image, "https://img/c.webp");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(canvasB.classList.has(GHOST), "previous canvas becomes the ghost");
  assert.equal(wrap.children.at(-1).drawn, bitmapC, "new canvas paints above the ghost");
  await settle();
  assert.equal(wrap.children.length, 2);

  swap(image, "https://img/c.webp");
  assert.equal(wrap.children.length, 2, "same artwork is not redrawn");
});

test("a failed bitmap decode falls back to the visible <img> layer", async () => {
  const { swap, wrap, image } = setup({
    "https://img/b.webp": { loaded: true, bitmap: { width: 1, height: 1 } },
    "https://img/d.webp": { loaded: true, bitmap: null }
  });
  swap(image, "https://img/b.webp");
  await settle();
  swap(image, "https://img/d.webp", "", 0, { transitionMode: "single-layer" });
  await settle();
  assert.deepEqual(wrap.children, [image]);
  assert.equal(image.getAttribute("src"), "https://img/d.webp");
  assert.equal(image.style.props.visibility, undefined);
  assert.ok(!image.classList.has("home-hero-backdrop-transition-enter"));
});
