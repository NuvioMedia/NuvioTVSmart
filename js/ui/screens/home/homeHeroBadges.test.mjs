import test from "node:test";
import assert from "node:assert/strict";
import { renderModernHeroBadges } from "./modernHomeLayout.js";

const escapeHtml = (value) => String(value);

test("age rating and status share one Android-style badge", () => {
  assert.equal(
    renderModernHeroBadges(["VM14", "USCITO"], escapeHtml),
    '<span class="home-modern-hero-badge home-modern-hero-badge-combined"><span>VM14</span><span class="home-modern-hero-badge-divider" aria-hidden="true"></span><span>USCITO</span></span>'
  );
});

test("a lone age rating keeps its normal badge", () => {
  assert.equal(
    renderModernHeroBadges(["VM14"], escapeHtml),
    '<span class="home-modern-hero-badge">VM14</span>'
  );
  assert.equal(renderModernHeroBadges([], escapeHtml), "");
});
