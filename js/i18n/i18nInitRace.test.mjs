import assert from "node:assert/strict";
import test from "node:test";

// Each case imports a fresh module instance so the locale state starts empty,
// as it does on a TV that just launched.
let importCounter = 0;

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(String(key)) ? storage.get(String(key)) : null),
  setItem: (key, value) => storage.set(String(key), String(value)),
  removeItem: (key) => storage.delete(String(key))
};

function mockXhr(delays) {
  const originalXhr = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = class MockXhr {
    open(_method, url) {
      this.url = String(url);
    }
    send() {
      const locale = this.url.split("/i18n/")[1]?.replace(/\.json$/, "") || "base";
      setTimeout(() => {
        this.status = 200;
        this.responseText = JSON.stringify({ app_name: `Nuvio ${locale.toUpperCase()}` });
        this.onload?.();
      }, delays[locale] ?? 5);
    }
  };
  return () => {
    globalThis.XMLHttpRequest = originalXhr;
  };
}

async function loadI18n() {
  importCounter += 1;
  const { I18n } = await import(`./index.js?case=${importCounter}`);
  return I18n;
}

test("a slower earlier locale load does not overwrite the newer locale", async () => {
  const restoreXhr = mockXhr({ fr: 50, de: 5 });
  try {
    const I18n = await loadI18n();
    await Promise.all([I18n.init("fr"), I18n.init("de")]);
    assert.equal(I18n.getLocale(), "de");
    assert.equal(I18n.t("app_name"), "Nuvio DE");
  } finally {
    restoreXhr();
  }
});

test("overlapping init() calls for the same locale keep the translations", async () => {
  const restoreXhr = mockXhr({ de: 30 });
  try {
    const I18n = await loadI18n();
    await Promise.all([I18n.init("de"), I18n.init("de")]);
    assert.equal(I18n.getLocale(), "de");
    assert.equal(I18n.t("app_name"), "Nuvio DE");
  } finally {
    restoreXhr();
  }
});

test("a caller resolving the previous locale cannot revert the active one", async () => {
  const restoreXhr = mockXhr({ en: 5, de: 50 });
  try {
    const I18n = await loadI18n();
    await I18n.init("en");
    const first = I18n.init("de");
    const second = I18n.init("en");
    await Promise.all([first, second]);
    assert.equal(I18n.getLocale(), "en");
    assert.equal(I18n.t("app_name"), "Nuvio EN");
  } finally {
    restoreXhr();
  }
});
