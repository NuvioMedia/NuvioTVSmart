import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Android TV reference: ModernSidebarBlurPanel.kt SidebarNavigationItem
//   focused && selected -> secondary 28%
//   focused             -> white 12%
//   selected            -> secondary 15%
//   scale 1.1 with the 180 ms fast tween
// and LegacySidebarButton / SidebarNavigation use the same 180 ms focus tween.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function rule(css, selector) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing rule ${selector}`);
  const bodyStart = css.indexOf("{", start) + 1;
  return css.slice(bodyStart, css.indexOf("}", bodyStart));
}

const modern = await readFile(path.join(root, "css/components-08.css"), "utf8");
const legacy = await readFile(path.join(root, "css/components-07.css"), "utf8");

const navItem = rule(modern, ".modern-sidebar-nav-item");
const selected = rule(modern, ".modern-sidebar-nav-item.selected");
const focused = rule(modern, ".modern-sidebar-nav-item.focused");
const selectedFocused = rule(modern, ".modern-sidebar-nav-item.selected.focused");
const profileFocused = rule(modern, ".modern-sidebar-profile.focused");
const iconCircle = rule(modern, ".modern-sidebar-nav-icon-circle");

assert.match(navItem, /transform 180ms/);
assert.match(selected, /rgb\(var\(--secondary-color-rgb\)\s*\/\s*0\.15\)/);
assert.doesNotMatch(selected, /background:\s*var\(--secondary-color\)/);
assert.match(focused, /rgba\(255,\s*255,\s*255,\s*0\.12\)/);
assert.match(focused, /transform:\s*scale\(1\.1\)/);
assert.doesNotMatch(focused, /--focus-bg/);
assert.doesNotMatch(focused, /border-color/);
assert.match(selectedFocused, /rgb\(var\(--secondary-color-rgb\)\s*\/\s*0\.28\)/);
assert.match(profileFocused, /rgba\(255,\s*255,\s*255,\s*0\.12\)/);
assert.doesNotMatch(profileFocused, /scale\(/);
assert.doesNotMatch(profileFocused, /border-color/);
assert.match(iconCircle, /background:\s*transparent/);
assert.doesNotMatch(modern, /\.modern-sidebar-nav-item\.selected \.modern-sidebar-nav-icon-circle/);
assert.match(rule(legacy, ".home-nav-item"), /transform 180ms/);

console.log(
  "Sidebar focus parity fixtures passed: Modern and Legacy match Android TV focus states."
);
