import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source =
  (await readFile(new URL("../js/ui/ambient/ambientMode.js", import.meta.url), "utf8"))
    .replace(/^import .*;$/gm, "")
    .replace(/export const /g, "const ") + "\nglobalThis.subject = AmbientMode;";

for (const nativeAbort of [false, true]) {
  const timers = new Map();
  let timerId = 0;
  const images = [];
  const loads = [];
  const element = () => ({
    children: [],
    style: { setProperty() {} },
    classList: {
      values: new Set(),
      add(value) {
        this.values.add(value);
      },
      contains(value) {
        return this.values.has(value);
      }
    },
    isConnected: true,
    getBoundingClientRect: () => ({ width: 1920, height: 1080 }),
    setAttribute() {},
    appendChild(child) {
      this.children.push(child);
    },
    remove() {},
    set textContent(value) {
      this.children = [];
      this.text = value;
    }
  });
  const screen = { applyFocus() {} };
  const context = vm.createContext({
    ...(nativeAbort ? { AbortController } : {}),
    Event,
    Image: class {
      constructor() {
        this.naturalWidth = 1920;
        this.attributes = {};
        this.isConnected = true;
        this.getBoundingClientRect = () => ({ width: 1920, height: 1080 });
        images.push(this);
      }
      setAttribute(name, value) {
        this.attributes[name] = value;
      }
      removeAttribute(name) {
        delete this.attributes[name];
      }
      remove() {
        this.removed = true;
      }
      set src(value) {
        this.url = value;
      }
    },
    setTimeout(fn, delay) {
      const id = ++timerId;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    performance: { now: () => 1000 },
    console: { warn() {} },
    getComputedStyle: () => ({ opacity: "0" }),
    URL,
    document: {
      hidden: false,
      body: element(),
      activeElement: null,
      createElement: element,
      createDocumentFragment: () => new EventTarget(),
      dispatchEvent() {}
    },
    CustomEvent: Event,
    Platform: { isWebOS: () => false, isTizen: () => false },
    TizenScreenSaver: { block() {}, unblock() {} },
    isAmbientTrailerPlaying: () => false,
    Router: { getCurrent: () => "home", getCurrentScreen: () => screen },
    ProfileManager: { getActiveProfileId: () => "1" },
    AmbientModeStore: { get: () => ({ enabled: true, timeoutMinutes: 5, catalogKeys: [] }) },
    loadAmbientSlides(keys, signal) {
      return new Promise((resolve, reject) => loads.push({ signal, resolve, reject }));
    }
  });
  vm.runInContext(source, context);
  const ambient = context.subject;
  ambient.signature = "A";
  const slide = { title: "Title", backdropUrl: "backdrop", logoUrl: "logo", genres: ["Drama"] };
  const flush = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };
  const first = ambient.refresh();
  assert.equal(Boolean(loads[0].signal), nativeAbort);
  await ambient.refresh();
  assert.equal(loads.length, 1, "deduplicate preload and on-show refresh");
  loads[0].resolve([slide]);
  await first;
  assert.equal(ambient.slides.length, 1);
  ambient.show();
  assert.equal(images.length, 2, "load backdrop and logo concurrently without AbortController");
  assert.ok(images[0].attributes.style, "stage the backdrop in the document while loading");
  assert.ok(
    context.document.body.children.includes(images[0]),
    "attach the staging image to the document body"
  );
  // Legacy TV engines can report zero intrinsic width after a successful load.
  images[0].naturalWidth = 0;
  images[0].onload();
  images[1].onerror();
  assert.equal(images[0].attributes.style, undefined, "remove the staging style after load");
  assert.equal(images[0].removed, true, "remove the staging image after load");
  assert.equal(images[1].removed, true, "remove the staging image after error");
  await flush();
  assert.equal(ambient.root.children.length, 1, "render first slide");
  const copy = ambient.root.children[0].children[2];
  assert.equal(copy.children[0].text, "Title", "missing logo uses title");
  assert.equal(copy.children[1].text, "Drama");
  assert.ok([...timers.values()].some(({ delay }) => delay === 13250));
  const paintCheck = [...timers.entries()].find(([, timer]) => timer.delay === 500);
  assert.ok(paintCheck, "schedule the Ambient paint fallback check");
  timers.delete(paintCheck[0]);
  paintCheck[1].fn();
  assert.equal(
    ambient.root.children[0].classList.contains("ambient-static"),
    true,
    "show the loaded slide when the fade stays at zero opacity"
  );
  ambient.dismiss();
  assert.equal(timers.size, 0, "dismiss clears slideshow and image timers");

  ambient.show();
  const pending = images.slice(-2);
  const signal = ambient.slideSignal;
  ambient.dismiss();
  assert.equal(signal.aborted, true);
  for (const image of pending) {
    assert.equal(image.url, "", "cancel pending image downloads");
    assert.equal(image.onload, null);
    assert.equal(image.onerror, null);
  }
  await flush();
  assert.equal(timers.size, 0, "cancelled images cannot schedule another slide");

  ambient.show();
  for (const image of images.slice(-2)) image.onerror();
  await flush();
  assert.equal(ambient.root.children.length, 0, "failed backdrop is never rendered");
  assert.ok([...timers.values()].some(({ delay }) => delay === 15000));
  let swallowed = 0;
  const key = {
    keyCode: 13,
    preventDefault() {
      swallowed++;
    },
    stopImmediatePropagation() {}
  };
  ambient.key(key, false);
  ambient.key(key, true);
  assert.equal(swallowed, 2, "dismissal consumes both keydown and keyup");
  assert.equal(ambient.showing, false);
  assert.equal(timers.size, 0);

  // Settings/profile may change away and back while a legacy request is still running.
  const stale = ambient.refresh();
  ambient.signature = undefined;
  ambient.tick();
  ambient.signature = "A";
  const current = ambient.refresh();
  assert.equal(loads.length, 3);
  if (nativeAbort) assert.equal(loads[1].signal.aborted, true);
  loads[1].resolve([{ ...slide, title: "Stale" }]);
  await stale;
  assert.equal(ambient.slides.length, 0, "discard stale results even if signature matches again");
  assert.equal(ambient.loadingSignature, "A", "stale completion cannot unlock current load");
  loads[2].resolve([slide]);
  await current;
  assert.equal(ambient.slides[0].title, "Title");
  assert.equal(ambient.loadingSignature, null);
  const failed = ambient.refresh();
  loads[3].reject(new Error("offline"));
  await failed;
  assert.equal(
    ambient.slides[0].title,
    "Title",
    "retain successful selection on transient failure"
  );
}
console.log("Ambient legacy and native cancellation checks passed");
