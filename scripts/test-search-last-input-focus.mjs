import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Android SearchScreen: Up from the first results row returns to whichever of
// the voice button and the text field was focused last, not to the column.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadFactory(relPath, factoryName, internals) {
  const source = readFileSync(path.join(ROOT, relPath), "utf8")
    .replace(/^import \* as internals from .*$/m, "")
    .replace(/^export function/m, "function");
  const sandbox = { internals, console, Number, String, Boolean, Object, Array, Math };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${source}; globalThis.__factory = ${factoryName};`, sandbox);
  return sandbox.__factory;
}

function node({ id = "", classes = [], dataset = {} } = {}) {
  const set = new Set(classes);
  return {
    id,
    dataset: { ...dataset },
    classList: {
      contains: (name) => set.has(name),
      add: (name) => set.add(name),
      remove: (name) => set.delete(name)
    }
  };
}

function screenWith(lastWasVoice) {
  const discover = node({
    classes: ["search-discover-btn", "focusable"],
    dataset: { navZone: "header", navCol: "0" }
  });
  const voice = node({
    classes: ["search-voice-btn", "focusable"],
    dataset: { navZone: "header", navCol: "1" }
  });
  const input = node({
    id: "searchInput",
    classes: ["focusable"],
    dataset: { navZone: "header", navCol: "2" }
  });
  const card = node({
    classes: ["search-result-card", "focusable", "focused"],
    dataset: { navZone: "results", navRow: "0", navCol: "0" }
  });
  const methods03 = loadFactory(
    "js/ui/screens/search/searchScreenMethods-03-render-recent-searches.js",
    "createSearchScreenMethods03",
    {}
  )();
  const methods05 = loadFactory(
    "js/ui/screens/search/searchScreenMethods-05-ensure-header-visible.js",
    "createSearchScreenMethods05",
    { allowDpadRepeat: () => true }
  )();
  let focused = null;
  const screen = {
    ...methods05,
    getLastSearchInputNode: methods03.getLastSearchInputNode,
    lastSearchInputWasVoice: lastWasVoice,
    navModel: { header: [discover, voice, input], rows: [[card]], recentClear: null },
    container: {
      querySelector(selector) {
        if (selector === ".focusable.focused") return card;
        if (selector === ".search-voice-btn.focusable") return voice;
        if (selector === "#searchInput.focusable") return input;
        return null;
      }
    },
    focusNode(_current, target) {
      focused = target;
      return true;
    }
  };
  return { screen, voice, input, focused: () => focused };
}

test("Up from results returns to the voice button when it was used last", () => {
  const { screen, voice, focused } = screenWith(true);
  screen.handleSearchDpad({ keyCode: 38 });
  assert.equal(focused(), voice);
});

test("Up from results returns to the text field otherwise, whatever the column", () => {
  const { screen, input, focused } = screenWith(false);
  screen.handleSearchDpad({ keyCode: 38 });
  assert.equal(focused(), input);
});
