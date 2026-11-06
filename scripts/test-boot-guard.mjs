import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(rootDir, "boot-guard.js"), "utf8");

class FakeElement {
  constructor(tagName, document) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = document;
    this.style = { cssText: "" };
    this.children = [];
    this.parentNode = null;
    this.id = "";
    this.textContent = "";
    this.attributes = {};
    this.onblur = null;
    this.onclick = null;
    this.onfocus = null;
    this.onkeydown = null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      this.children.splice(index, 1);
      child.parentNode = null;
    }
    return child;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  focus() {
    const previous = this.ownerDocument.activeElement;
    if (previous && previous !== this && previous.onblur) {
      previous.onblur();
    }
    this.ownerDocument.activeElement = this;
    if (this.onfocus) {
      this.onfocus();
    }
  }

  walk(callback) {
    callback(this);
    for (const child of this.children) {
      child.walk(callback);
    }
  }
}

function createHarness({ platformVersion, userAgent }) {
  const document = {
    activeElement: null,
    body: null,
    documentElement: null,
    createElement(tagName) {
      return new FakeElement(tagName, document);
    },
    getElementById(id) {
      let found = null;
      document.body.walk((element) => {
        if (!found && element.id === id) {
          found = element;
        }
      });
      return found;
    }
  };
  document.body = new FakeElement("body", document);
  document.documentElement = new FakeElement("html", document);

  const window = {
    addEventListener() {},
    clearTimeout() {},
    document,
    localStorage: { getItem: () => null },
    location: { reload() {} },
    navigator: { language: "en", languages: ["en"], userAgent },
    setTimeout: () => 0,
    tizen: {
      systeminfo: {
        getCapability: () => platformVersion
      }
    },
    webapis: {
      productinfo: {
        getFirmware: () => "T-INFOLINK2017",
        getModel: () => "UE55MU8500"
      }
    }
  };

  const context = vm.createContext({ console, document, window });
  vm.runInContext(source, context, { filename: "boot-guard.js" });
  return { document, guard: window.NuvioBootGuard };
}

const options = {
  platform: "tizen",
  minVersion: 4,
  minChrome: 56,
  requiredLabel: "Samsung Tizen 4.0+ · Chromium 56+ (2018+)"
};

function buttons(document) {
  const result = [];
  document.body.walk((element) => {
    if (element.tagName === "BUTTON") {
      result.push(element);
    }
  });
  return result;
}

test("engine below the bundle target cannot offer Try anyway", () => {
  const { document, guard } = createHarness({
    platformVersion: "3.0",
    userAgent:
      "Mozilla/5.0 (SMART-TV; Linux; Tizen 3.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/47.0.2526.69 TV Safari/537.36"
  });
  let started = false;
  guard.runCompatibilityGate(options, () => {
    started = true;
  });

  assert.equal(started, false);
  const all = buttons(document);
  assert.deepEqual(
    all.map((button) => button.textContent),
    ["Close"]
  );
  assert.equal(all[0].style.background, "#ffffff");
  assert.equal(all[0].style.transform, "scale(1.1)");
});

test("engine that can parse the bundle keeps the Try anyway path with visible focus", () => {
  const { document, guard } = createHarness({
    platformVersion: "3.0",
    userAgent:
      "Mozilla/5.0 (SMART-TV; Linux; Tizen 3.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/56.0.2924.87 TV Safari/537.36"
  });
  guard.runCompatibilityGate(options, () => {});

  const [close, tryAnyway] = buttons(document);
  assert.equal(tryAnyway.textContent, "Try anyway");
  assert.equal(close.style.background, "#ffffff");
  assert.equal(tryAnyway.style.background, "#242424");

  close.onkeydown({ keyCode: 39, preventDefault() {}, stopPropagation() {} });

  assert.equal(document.activeElement, tryAnyway);
  assert.equal(close.style.background, "#242424");
  assert.equal(close.style.transform, "scale(1)");
  assert.equal(tryAnyway.style.background, "#ffffff");
  assert.equal(tryAnyway.style.color, "#121212");
  assert.equal(tryAnyway.style.transform, "scale(1.1)");
});

test("boot error retry shows a visible focus state", () => {
  const { document, guard } = createHarness({
    platformVersion: "5.5",
    userAgent:
      "Mozilla/5.0 (SMART-TV; Linux; Tizen 5.5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.106 TV Safari/537.36"
  });
  guard.fail("Something went wrong", "SyntaxError", "BOOT-RUNTIME");

  const [retry] = buttons(document);
  assert.equal(retry.textContent, "Retry");
  assert.equal(document.activeElement, retry);
  assert.equal(retry.style.background, "#ffffff");
  assert.equal(retry.style.color, "#121212");
  assert.equal(retry.style.transform, "scale(1.1)");
});
