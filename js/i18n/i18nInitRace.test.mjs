import assert from "node:assert/strict";
import test from "node:test";

const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(String(k)) ? storage.get(String(k)) : null),
  setItem: (k, v) => storage.set(String(k), String(v)),
  removeItem: (k) => storage.delete(String(k))
};

const { I18n } = await import("./index.js");

test("I18n.init ignores slower earlier locale completion when a newer init resolves first", async () => {
  const originalXhr = globalThis.XMLHttpRequest;
  try {
    globalThis.XMLHttpRequest = class MockXhr {
      open(_method, url) {
        this.url = String(url);
      }
      send() {
        const delayMs = this.url.includes("fr.json") ? 50 : 5;
        const messages = this.url.includes("fr.json")
          ? { app_name: "Nuvio FR" }
          : { app_name: "Nuvio DE" };
        setTimeout(() => {
          this.status = 200;
          this.responseText = JSON.stringify(messages);
          this.onload?.();
        }, delayMs);
      }
    };

    await Promise.all([I18n.init("fr"), I18n.init("de")]);
    assert.equal(I18n.getLocale(), "de");
    assert.equal(I18n.t("app_name"), "Nuvio DE");
  } finally {
    globalThis.XMLHttpRequest = originalXhr;
  }
});
