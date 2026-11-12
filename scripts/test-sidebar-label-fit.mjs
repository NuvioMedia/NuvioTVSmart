import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fitSidebarLabel } from "../js/ui/components/sidebarNavigationHelpers-01-root-sidebar-items.js";

// Android TV ModernSidebarBlurPanel.kt SidebarProfileItem uses AutoResizeText
// (TextOverflow.Clip, 1sp steps, 9sp floor). The Web TV equivalent has to
// shrink the profile name until the rendered text fits its box: any accepted
// overflow makes the browser replace the tail of the name with an ellipsis,
// so the fit must compare the integer scrollWidth against clientWidth without
// tolerating the extra rounded pixel.

const BASE_FONT_SIZE = 39.936;
const originalGetComputedStyle = globalThis.getComputedStyle;
globalThis.getComputedStyle = () => ({ fontSize: `${BASE_FONT_SIZE}px` });

function makeLabel({ widthPerFontPx, boxWidth }) {
  const style = {};
  return {
    isConnected: true,
    style,
    clientWidth: Math.round(boxWidth),
    get scrollWidth() {
      const size = Number.parseFloat(style.fontSize) || BASE_FONT_SIZE;
      return Math.round(size * widthPerFontPx);
    },
    getBoundingClientRect() {
      return { width: boxWidth };
    }
  };
}

try {
  // "Jontebusk" in the modern sidebar: 169px slot, text a hair wider than the
  // slot at the previously chosen 35.48px (169.96px), which Tizen and every
  // Chromium painted as "Jontebu…".
  const longName = makeLabel({ widthPerFontPx: 4.79, boxWidth: 168.875 });
  assert.equal(fitSidebarLabel(longName, 18), true);
  const fittedSize = Number.parseFloat(longName.style.fontSize);
  assert.ok(fittedSize < 35.48, `expected a tighter fit than 35.48px, got ${fittedSize}px`);
  assert.ok(
    Math.round(fittedSize * 4.79) <= longName.clientWidth,
    `fitted text still overflows the ${longName.clientWidth}px slot: ${fittedSize}px`
  );

  const shortName = makeLabel({ widthPerFontPx: 2, boxWidth: 168.875 });
  assert.equal(fitSidebarLabel(shortName, 18), true);
  assert.equal(shortName.style.fontSize, "", "a name that already fits must keep its CSS size");

  const scaledNameOnly = makeLabel({ widthPerFontPx: 40, boxWidth: 168.875 });
  assert.equal(fitSidebarLabel(scaledNameOnly, 18), true);
  assert.equal(scaledNameOnly.style.fontSize, "18px", "the fit stops at the Android TV 9sp floor");
} finally {
  globalThis.getComputedStyle = originalGetComputedStyle;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = await readFile(path.join(root, "css/components-08.css"), "utf8");

function rule(css, selector) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing rule ${selector}`);
  const bodyStart = css.indexOf("{", start) + 1;
  return css.slice(bodyStart, css.indexOf("}", bodyStart));
}

assert.match(rule(css, ".modern-sidebar-profile-name"), /text-overflow:\s*clip/);
// Android's legacy sidebar draws the profile name as Text(overflow = Ellipsis).
assert.match(rule(css, ".home-profile-name"), /text-overflow:\s*ellipsis/);

console.log(
  "Sidebar label fit parity fixtures passed: profile names shrink like Android TV AutoResizeText."
);
