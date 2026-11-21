// Touch-tier probe suite, regression gate for the mobile web (.web-touch) tier.
// Per-screen audits at 390x844 with touch: horizontal overflow, offscreen
// elements, sub-44px tap targets, and overlapping leaf text pairs.
// Requires a built app served over http (what CI does; locally:
//   npm run build && npm run serve   # port 4173
//   npm run test:touch-probe).
// BASE_URL env overrides the server origin. Exit 0 = all screens pass.
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = (process.env.BASE_URL || "http://127.0.0.1:4173").replace(/\/+$/, "");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const VW = 390,
  VH = 844,
  OVER = 4;

const AUDIT = (scopeSelector) => {
  const VW = 390,
    VH = 844,
    OVER = 4;
  const root = scopeSelector ? document.querySelector(scopeSelector) : document.body;
  if (!root) return { missing: scopeSelector };
  const vis = (el) => {
    const r = el.getBoundingClientRect(),
      s = getComputedStyle(el);
    return (
      r.width > 0 &&
      r.height > 0 &&
      s.display !== "none" &&
      s.visibility !== "hidden" &&
      s.opacity !== "0"
    );
  };
  const fails = [];
  if (document.documentElement.scrollWidth > VW + OVER)
    fails.push({ kind: "h-overflow", scrollW: document.documentElement.scrollWidth });
  const hScroller = (el) => {
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (["auto", "scroll"].includes(s.overflowX) && a.scrollWidth > a.clientWidth + 2)
        return true;
    }
    return false;
  };
  const off = [...root.querySelectorAll("*")]
    .filter((el) => {
      if (!vis(el) || hScroller(el)) return false;
      const r = el.getBoundingClientRect();
      return (
        r.width > 20 &&
        (r.right > VW + OVER || r.left < -OVER || r.bottom > VH + 2000 || r.top < -VH * 4)
      );
    })
    .slice(0, 10)
    .map((el) => ({
      kind: "offscreen",
      cls: el.className.toString().slice(0, 45),
      r: ((b) => ({
        x: Math.round(b.x),
        y: Math.round(b.y),
        w: Math.round(b.width),
        h: Math.round(b.height)
      }))(el.getBoundingClientRect())
    }));
  off.forEach((o) => fails.push(o));
  const small = [...root.querySelectorAll("button,[data-focusable],a,input,select,summary")]
    .filter(vis)
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(
      ({ el, r }) => (r.width < 44 || r.height < 40) && getComputedStyle(el).position !== "fixed"
    )
    .slice(0, 10)
    .map(({ el, r }) => ({
      kind: "tap-target",
      cls: el.className.toString().slice(0, 45) || el.tagName.toLowerCase(),
      w: Math.round(r.width),
      h: Math.round(r.height)
    }));
  small.forEach((s) => fails.push(s));
  const texts = [...root.querySelectorAll("h1,h2,h3,p,span,li,label,button,td,th")].filter(
    (el) =>
      vis(el) &&
      (el.innerText || "").trim() &&
      ![...el.children].some((c) => (c.innerText || "").trim() === (el.innerText || "").trim())
  );
  const rects = texts
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter((x) => x.r.width > 2 && x.r.height > 2);
  const hits = [];
  // Overlay layers in the player are separate states (controls vs seek overlay
  // vs skip-intro vs episode panel vs modal). Their texts only coexist in the
  // static harness; real playback swaps them, so cross-layer pairs are skipped.
  const layerOf = (el) =>
    el.closest(
      ".player-controls-overlay,.player-seek-overlay,.player-skip-intro,.player-episode-panel,.player-modal,.player-pause-overlay-content,.player-chapters-list"
    );
  for (let i = 0; i < rects.length && hits.length < 6; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i],
        b = rects[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const la = layerOf(a.el),
        lb = layerOf(b.el);
      if (la && lb && la !== lb) continue;
      const ox = Math.max(0, Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left));
      const oy = Math.max(0, Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top));
      const minArea = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
      if (ox * oy > 0.35 * minArea)
        hits.push({
          kind: "text-overlap",
          a: a.el.innerText.slice(0, 20),
          b: b.el.innerText.slice(0, 20)
        });
    }
  hits.forEach((h) => fails.push(h));
  return fails;
};

const results = [];
async function audit(page, label, scope) {
  const fails = await page.evaluate(AUDIT, scope || "");
  const ok = Array.isArray(fails) && fails.length === 0;
  results.push({ label, ok, fails: Array.isArray(fails) ? fails : [fails] });
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : " " + JSON.stringify(fails)}`);
}

async function gotoHome(page) {
  await page.goto(BASE_URL + "/", { waitUntil: "domcontentloaded" });
  const back = page.locator("#qr-back-btn");
  if (await back.count()) {
    await back.tap().catch(() => {});
    await page.waitForTimeout(9000);
  } else await page.waitForTimeout(6000);
}
async function navTo(page, text) {
  await page.evaluate(
    (t) =>
      [...document.querySelectorAll(".home-nav-item")]
        .find((n) => n.innerText.includes(t))
        ?.click(),
    text
  );
  await page.waitForTimeout(2500);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: VW, height: VH },
  hasTouch: true,
  isMobile: true
});
const harnessOnly = process.argv.includes("--harness-only");

if (!harnessOnly) {
  const page = await ctx.newPage();
  await gotoHome(page); // first run bypasses auth (guest); later runs go straight home
  await audit(page, "home");

  await page.evaluate(() => document.querySelector(".home-track .home-poster-card")?.click());
  await page.waitForTimeout(2500);
  await audit(page, "detail");

  await gotoHome(page);
  await navTo(page, "Search");
  await audit(page, "search");
  const inp = page.locator(".search-screen-shell input").first();
  if (await inp.count()) {
    await inp.tap();
    await inp.type("the", { delay: 60 });
    await page.waitForTimeout(3500);
    await audit(page, "search-results");
  }

  await gotoHome(page);
  await navTo(page, "Library");
  await audit(page, "library");

  await gotoHome(page);
  await navTo(page, "Settings");
  await audit(page, "settings");
  await page.evaluate(() =>
    [...document.querySelectorAll(".settings-nav-item")]
      .find((n) => /Player|Playback/.test(n.innerText))
      ?.click()
  );
  await page.waitForTimeout(1500);
  await audit(page, "settings-player");
}

// Static player harness: the live player needs an authenticated account with
// stream sources, so the player surfaces are exercised against a fixture that
// mounts every player layer at once. Served CSS comes from BASE_URL.
const harnessHtml = (await readFile(path.join(HERE, "player-harness.html"), "utf8")).replaceAll(
  "http://127.0.0.1:4173",
  BASE_URL
);
const p2 = await ctx.newPage();
await p2.setContent(harnessHtml, { waitUntil: "domcontentloaded" });
await p2.waitForTimeout(1200);
await audit(p2, "player-harness", "#playerUiRoot");

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} screens pass`);
process.exit(failed.length ? 1 : 0);
