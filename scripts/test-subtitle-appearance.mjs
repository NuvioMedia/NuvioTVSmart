import test from "node:test";
import assert from "node:assert/strict";

import {
  hasVisibleSubtitleBackground,
  normalizeSubtitleAppearance,
  subtitleBackgroundRadiusCss,
  subtitleDropShadowCss,
  subtitleFontFamilyCss,
  subtitleOutlineShadowCss
} from "../js/core/player/subtitleAppearance.js";
import { buildSubtitleAppearancePreviewHtml } from "../js/ui/screens/settings/subtitleAppearanceEditor.js";

test("appearance values are kept in Android's ranges", () => {
  assert.deepEqual(normalizeSubtitleAppearance({}), {
    fontId: "default",
    backgroundRadius: 0,
    shadowEnabled: false,
    shadowOpacity: 75,
    shadowSize: 2,
    outlineSize: 2
  });
  const clamped = normalizeSubtitleAppearance({
    fontId: "custom-x",
    backgroundRadius: 99,
    shadowOpacity: -3,
    shadowSize: 40,
    outlineSize: 9
  });
  assert.equal(clamped.fontId, "default");
  assert.equal(clamped.backgroundRadius, 24);
  assert.equal(clamped.shadowOpacity, 0);
  assert.equal(clamped.shadowSize, 8);
  assert.equal(clamped.outlineSize, 5);
});

test("the drop shadow is offset by its size and blurred by twice it, in 24-unit text", () => {
  assert.equal(subtitleDropShadowCss({ shadowEnabled: false }), "none");
  assert.equal(
    subtitleDropShadowCss({ shadowEnabled: true, shadowSize: 2, shadowOpacity: 75 }),
    "0.0833em 0.0833em 0.1667em rgba(0, 0, 0, 0.75)"
  );
});

test("the outline width keeps the 2px edge at the default size", () => {
  assert.equal(subtitleOutlineShadowCss({ outlineEnabled: false }), "");
  assert.equal(
    subtitleOutlineShadowCss({ outlineEnabled: true }),
    "0 0 2px #000000, 0 0 4px #000000"
  );
  assert.equal(
    subtitleOutlineShadowCss({ outlineEnabled: true }, { crisp: true }),
    "-2px -2px 0 #000000, 0 -2px 0 #000000, 2px -2px 0 #000000, -2px 0 0 #000000, 2px 0 0 #000000, -2px 2px 0 #000000, 0 2px 0 #000000, 2px 2px 0 #000000"
  );
  assert.equal(
    subtitleOutlineShadowCss(
      { outlineEnabled: true, outlineSize: 1 },
      { crisp: true, color: "#123456" }
    ),
    "-1px -1px 0 #123456, 0 -1px 0 #123456, 1px -1px 0 #123456, -1px 0 0 #123456, 1px 0 0 #123456, -1px 1px 0 #123456, 0 1px 0 #123456, 1px 1px 0 #123456"
  );
});

test("the settings preview scales the outline for Android's half-unit stroke per step", () => {
  const preview = (outlineSize) =>
    buildSubtitleAppearancePreviewHtml(
      { outlineEnabled: true, outlineSize, textColor: "#FFFFFF", textOpacity: 100 },
      { t: (_key, _params, fallback) => fallback, escapeHtml: (value) => value }
    );
  assert.match(preview(2), /-0\.0417em 0 0 rgba\(0, 0, 0, 1\)/);
  assert.match(preview(5), /-0\.1042em 0 0 rgba\(0, 0, 0, 1\)/);
  assert.doesNotMatch(preview(1), /0\.1042em/);
});

test("roundness, fonts and background visibility", () => {
  assert.equal(subtitleBackgroundRadiusCss({ backgroundRadius: 12 }), "0.5000em");
  assert.equal(subtitleFontFamilyCss("default"), null);
  assert.match(subtitleFontFamilyCss("serif"), /serif$/);
  assert.match(subtitleFontFamilyCss("mono"), /monospace$/);
  assert.equal(hasVisibleSubtitleBackground("#00000000"), false);
  assert.equal(hasVisibleSubtitleBackground("#00000080"), true);
  assert.equal(hasVisibleSubtitleBackground("#000000"), true);
  assert.equal(hasVisibleSubtitleBackground("transparent"), false);
});
