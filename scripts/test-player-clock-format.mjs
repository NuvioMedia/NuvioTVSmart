import test from "node:test";
import assert from "node:assert/strict";

import {
  buildClockFormatOptions,
  parsePlatformTimeFormat,
  resolveSystemHour12
} from "../js/core/player/clockFormat.js";

// Tizen and webOS runtimes can expose their own locale as the Intl default
// even when the app formats with a different locale. Keep the two independent
// so the tests cover the mismatch reported for Swedish.
const defaultLocaleIntl = (defaultLocale) => ({
  DateTimeFormat: function (requestedLocale, options) {
    return new Intl.DateTimeFormat(requestedLocale || defaultLocale, options);
  }
});

const clockText = (locale, hour12, date = new Date(2026, 9, 28, 2, 33)) =>
  new Intl.DateTimeFormat(locale, buildClockFormatOptions(hour12)).format(date);

test("Tizen 24-hour pattern keeps the Swedish clock at 24 hours", () => {
  const hour12 = resolveSystemHour12({
    tizenApi: { time: { getTimeFormat: () => "h:m:s" } },
    intlApi: defaultLocaleIntl("en-US"),
    locale: "sv"
  });
  assert.equal(hour12, false);
  assert.equal(clockText("sv", hour12), "02:33");
});

test("Tizen 9 ap pattern follows a 24-hour formatting locale", () => {
  const hour12 = resolveSystemHour12({
    tizenApi: { time: { getTimeFormat: () => "h:m:s ap" } },
    intlApi: defaultLocaleIntl("en-US"),
    locale: "fr"
  });
  assert.equal(hour12, false);
  assert.equal(clockText("fr", hour12), "02:33");
});

test("Tizen keeps 12-hour time for a 12-hour formatting locale", () => {
  const hour12 = resolveSystemHour12({
    tizenApi: { time: { getTimeFormat: () => "h:m:s ap" } },
    intlApi: defaultLocaleIntl("en-US"),
    locale: "en-US"
  });
  assert.equal(hour12, true);
  assert.equal(clockText("en-US", hour12), "02:33 AM");
});

test("Tizen 24-hour pattern wins over a 12-hour formatting locale", () => {
  const hour12 = resolveSystemHour12({
    tizenApi: { time: { getTimeFormat: () => "H:m:s" } },
    intlApi: defaultLocaleIntl("en-US"),
    locale: "en-US"
  });
  assert.equal(hour12, false);
});

test("webOS explicit clock preference wins", () => {
  assert.equal(
    resolveSystemHour12({ webOsLocaleInfo: { clock: "12" }, intlApi: Intl, locale: "sv" }),
    true
  );
  assert.equal(
    resolveSystemHour12({ webOsLocaleInfo: { clock: "24" }, intlApi: Intl, locale: "en-US" }),
    false
  );
});

test("webOS locale clock uses the system format locale", () => {
  const hour12 = resolveSystemHour12({
    webOsLocaleInfo: { clock: "locale", locales: { FMT: "fr-FR" } },
    intlApi: defaultLocaleIntl("en-US"),
    locale: "en"
  });
  assert.equal(hour12, false);
});

test("without a platform format the formatting locale decides", () => {
  assert.equal(resolveSystemHour12({ intlApi: Intl, locale: "sv" }), false);
  assert.equal(resolveSystemHour12({ intlApi: Intl, locale: "en-US" }), true);
});

test("a failing Tizen API falls back to the formatting locale", () => {
  const hour12 = resolveSystemHour12({
    tizenApi: {
      time: {
        getTimeFormat() {
          throw new Error("unavailable");
        }
      }
    },
    intlApi: Intl,
    locale: "sv"
  });
  assert.equal(hour12, false);
});

test("parsePlatformTimeFormat understands Tizen and LDML patterns", () => {
  assert.equal(parsePlatformTimeFormat("h:m:s ap"), true);
  assert.equal(parsePlatformTimeFormat("h:mm a"), true);
  assert.equal(parsePlatformTimeFormat("h:m:s"), false);
  assert.equal(parsePlatformTimeFormat("HH:mm"), false);
  assert.equal(parsePlatformTimeFormat("K:mm"), true);
  assert.equal(parsePlatformTimeFormat("'ap' h:m:s"), false);
  assert.equal(parsePlatformTimeFormat(""), null);
});
