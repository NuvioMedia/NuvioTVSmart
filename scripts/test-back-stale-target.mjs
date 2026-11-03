// Back must survive a re-render that replaced the element it targeted.
//
// Reported in #1081: a collection folder whose rows come back empty leaves
// nothing focusable and Back stops working, so the only way out is to quit the
// app. Key events are delivered asynchronously, so a Back pressed while the
// folder re-renders arrives pointing at a node the render has already removed.
// focusEngine.handleKey dropped every such event before it reached the Back
// branch, while handleKeyUp has always cleared its Back latch ahead of the
// same guard.

import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const bundle = await build({
  entryPoints: ["js/ui/navigation/focusEngine.js"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "subject",
  plugins: [
    {
      name: "fixtures",
      setup(builder) {
        builder.onLoad({ filter: /focusEngine\.js$/ }, async ({ path }) => {
          const source = await readFile(path, "utf8");
          return {
            contents: source.replace(
              /^import \{([\s\S]*?)\} from "([^"]+)";/gm,
              (_all, names) => `const {${names}} = fixtures;`
            ),
            loader: "js"
          };
        });
      }
    }
  ]
});

function makeEngine({ modalOpen = false } = {}) {
  const calls = [];
  const liveNode = { tag: "live" };
  const replacedNode = { tag: "removed-by-render" };

  const fakeDocument = {
    body: { tag: "body", classList: { contains: () => modalOpen, add() {} } },
    documentElement: { classList: { add() {} } },
    contains(node) {
      return node === liveNode || node === this.body;
    },
    addEventListener() {}
  };

  const fixtures = {
    Router: {
      back: () => calls.push("Router.back"),
      getCurrentScreen: () => ({
        consumeBackRequest: () => {
          calls.push("consumeBackRequest");
          return false;
        },
        onKeyDown: () => calls.push("screen.onKeyDown")
      }),
      consumeRouteReturnBackGuard: () => false,
      suppressNextPopstate: () => calls.push("suppressNextPopstate")
    },
    Platform: {
      isWebOS: () => true,
      isBackEvent: (event) => Number(event?.keyCode) === 461 || event?.key === "Back",
      normalizeKey: (event) => ({
        key: event?.key || "",
        code: event?.code || "",
        keyName: event?.key || "",
        keyCode: Number(event?.keyCode || 0),
        originalKeyCode: Number(event?.keyCode || 0)
      })
    }
  };

  const globals = {
    fixtures,
    console,
    Date,
    Map,
    Set,
    Number,
    String,
    Boolean,
    Math,
    Promise,
    document: fakeDocument,
    window: { addEventListener() {} },
    requestAnimationFrame: (callback) => callback()
  };
  globals.globalThis = globals;
  const context = vm.createContext(globals);
  vm.runInContext(bundle.outputFiles[0].text, context);

  const engine = context.subject.FocusEngine;
  const reset = () => {
    calls.length = 0;
    engine.lastBackHandledAt = 0;
    engine.activeBackKeyIdentities.clear();
    engine.activeKeyDownStartedAt.clear();
  };
  return { engine, calls, liveNode, replacedNode, reset };
}

const keyEvent = (target, { keyCode = 461, key = "Back" } = {}) => ({
  type: "keydown",
  keyCode,
  key,
  code: key,
  target,
  repeat: false,
  timeStamp: Date.now(),
  preventDefault() {},
  stopPropagation() {},
  stopImmediatePropagation() {}
});

test("Back navigates when the element it targeted is still in the document", () => {
  const { engine, calls, liveNode, reset } = makeEngine();
  reset();
  engine.handleKey(keyEvent(liveNode));
  assert.deepEqual(calls, ["consumeBackRequest", "Router.back"]);
});

test("Back still navigates when a re-render replaced the element it targeted", () => {
  // This is the #1081 trap. Before the fix these calls were empty.
  const { engine, calls, replacedNode, reset } = makeEngine();
  reset();
  engine.handleKey(keyEvent(replacedNode));
  assert.deepEqual(calls, ["consumeBackRequest", "Router.back"]);
});

test("every Back press on a screen with nothing focusable still gets out", () => {
  // The user mashes Back on an empty folder while it churns. Each press is
  // delivered against a node the last render removed. None may be dropped.
  const { engine, calls, replacedNode, reset } = makeEngine();
  reset();
  for (let press = 0; press < 3; press += 1) {
    engine.lastBackHandledAt = 0;
    engine.activeBackKeyIdentities.clear();
    engine.handleKey(keyEvent(replacedNode));
  }
  assert.equal(calls.filter((call) => call === "Router.back").length, 3);
});

test("an ordinary key aimed at a replaced element is still discarded", () => {
  // The staleness guard exists for a reason and must keep working for
  // everything that is not Back, or a queued D-pad press would move focus
  // inside a screen the user has already left.
  const { engine, calls, replacedNode, liveNode, reset } = makeEngine();
  reset();
  engine.handleKey(keyEvent(replacedNode, { keyCode: 40, key: "ArrowDown" }));
  assert.deepEqual(calls, [], "a stale arrow key must not reach the screen");

  reset();
  engine.handleKey(keyEvent(liveNode, { keyCode: 40, key: "ArrowDown" }));
  assert.deepEqual(calls, ["screen.onKeyDown"], "a live arrow key must still reach the screen");
});

test("an open modal still swallows Back, including a stale one", () => {
  // Dialogs handle their own Back. Letting it through here would close the
  // dialog and navigate in the same press.
  const { engine, calls, liveNode, replacedNode, reset } = makeEngine({ modalOpen: true });
  reset();
  engine.handleKey(keyEvent(liveNode));
  engine.handleKey(keyEvent(replacedNode));
  assert.deepEqual(calls, []);
});

test("a held Back is still one action, not one per repeat", () => {
  const { engine, calls, replacedNode, reset } = makeEngine();
  reset();
  engine.handleKey(keyEvent(replacedNode));
  engine.handleKey(keyEvent(replacedNode));
  assert.equal(
    calls.filter((call) => call === "Router.back").length,
    1,
    "the key latch must still debounce"
  );
});
