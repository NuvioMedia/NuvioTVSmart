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
  // TV-scale guard: the Android TV dp x 2 port (96px buttons, 40px text
  // line-heights) has repeatedly bled through into the phone tier when a
  // re-derivation was mis-scoped. App screens only (not the player harness,
  // whose overlays are legitimately large); poster/content cards excluded.
  if (!scopeSelector) {
    for (const el of root.querySelectorAll("button")) {
      if (!vis(el) || /-card/.test(el.className.toString())) continue;
      const h = el.getBoundingClientRect().height;
      if (h > 72)
        fails.push({
          kind: "tv-scale",
          cls: el.className.toString().slice(0, 40),
          h: Math.round(h)
        });
    }
    for (const el of root.querySelectorAll("p")) {
      if (!vis(el)) continue;
      const lh = parseFloat(getComputedStyle(el).lineHeight);
      if (lh > 30)
        fails.push({
          kind: "tv-scale-lh",
          cls: el.className.toString().slice(0, 40),
          lh: Math.round(lh)
        });
    }
  }
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

// Real swipe gate: dispatch a horizontal touch drag across the first home rail
// and require the rail to actually scroll. Also asserts the rail exposes a
// swipeable overflow with snap and does not disable touch panning.
async function swipeGate(page) {
  const pre = await page.evaluate(() => {
    const track = [...document.querySelectorAll(".home-track")].find(
      (t) => t.scrollWidth > t.clientWidth + 40
    );
    if (!track) return { found: false };
    const s = getComputedStyle(track);
    window.__swipeTarget = track;
    const r = track.getBoundingClientRect();
    return {
      found: true,
      overflowX: s.overflowX,
      snap: s.scrollSnapType,
      touchAction: s.touchAction,
      scrollLeft: track.scrollLeft,
      y: Math.round(r.top + r.height / 2)
    };
  });
  if (!pre.found) return [{ kind: "swipe", why: "no swipeable .home-track found" }];
  const cdp = await page.context().newCDPSession(page);
  const send = (type, x) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y: pre.y }]
    });
  // Continuous cadence (~15ms): gaps >20ms make Chromium end each move as its
  // own scroll gesture, and scroll-snap yanks the rail back between moves.
  await send("touchStart", 340);
  for (let x = 320; x >= 70; x -= 20) {
    await send("touchMove", x);
    await page.waitForTimeout(15);
  }
  await send("touchEnd", 70);
  await page.waitForTimeout(400);
  const post = await page.evaluate(() => ({ scrollLeft: window.__swipeTarget.scrollLeft }));
  const problems = [];
  if (!["auto", "scroll"].includes(pre.overflowX))
    problems.push({ kind: "swipe", why: "overflowX=" + pre.overflowX });
  if (pre.touchAction === "none")
    problems.push({ kind: "swipe", why: "touchAction=" + pre.touchAction });
  if (!/x/.test(pre.snap)) problems.push({ kind: "swipe", why: "scroll-snap=" + pre.snap });
  // Chromium reports pan-allowing touch-action as "manipulation"/"auto"; pan-x
  // and pan-y still allow panning the rail. Only "none" is a hard block.
  if (post.scrollLeft - pre.scrollLeft < 50)
    problems.push({
      kind: "swipe",
      why: `rail did not scroll (${pre.scrollLeft} -> ${post.scrollLeft})`
    });
  return problems;
}

const browser = await chromium.launch();
// Phone sign-in audit (task: replace QR with native flow on the touch tier).
// A) Official server (tvLogin-only): the phone must offer a same-device path,
//    not just a scannable QR: QR canvas visible AND a >=44px open-on-this-device link.
// B) Server declaring both caps: the phone must land on the native email form
//    by default (capability default), with autofill attrs, 44px targets, local
//    validation on empty submit, and a one-tap inline mode switch.
async function authPhoneGate(browser) {
  const qrProblems = [];
  const emailProblems = [];
  const probe = (page, sel) =>
    page.evaluate((s) => {
      const e = document.querySelector(s);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      const st = getComputedStyle(e);
      if (r.width <= 0 || r.height <= 0 || st.display === "none" || st.visibility === "hidden")
        return { hidden: true, h: Math.round(r.height) };
      return {
        h: Math.round(r.height),
        ac: e.getAttribute("autocomplete") || "",
        type: e.getAttribute("type") || ""
      };
    }, sel);

  const opts = { viewport: { width: VW, height: VH }, hasTouch: true, isMobile: true };

  const ctxA = await browser.newContext(opts);
  const a = await ctxA.newPage();
  await a.goto(BASE_URL + "/", { waitUntil: "domcontentloaded" });
  await a.waitForSelector("#qr-container, #auth-email-form", { timeout: 20000 }).catch(() => {});
  await a.waitForTimeout(3000);
  if (!(await a.evaluate(() => document.body.classList.contains("web-touch"))))
    qrProblems.push({ kind: "auth", why: "boot screen missing .web-touch" });
  if (await a.evaluate(() => !!document.querySelector("#auth-email-form")))
    qrProblems.push({ kind: "auth", why: "email form shown on tvLogin-only server" });
  const qrBox = await probe(a, "#qr-container canvas");
  if (!qrBox || qrBox.hidden || qrBox.h < 150)
    qrProblems.push({ kind: "auth", why: "QR not visible: " + JSON.stringify(qrBox) });
  const link = await probe(a, ".qr-open-link-primary");
  if (!link || link.hidden || link.h < 44)
    qrProblems.push({
      kind: "auth",
      why: "open-on-this-device link missing/<44px: " + JSON.stringify(link)
    });
  await ctxA.close();

  const ctxB = await browser.newContext(opts);
  await ctxB.addInitScript(
    ([key, payload]) => localStorage.setItem(key, payload),
    [
      "nuvioServerConfigurationV1",
      JSON.stringify({
        isCustom: true,
        backendUrl: BASE_URL + "/probe-srv",
        publishableKey: "pk-probe-test",
        capabilities: { emailPasswordAuth: true, tvLogin: true }
      })
    ]
  );
  const b = await ctxB.newPage();
  await b.goto(BASE_URL + "/", { waitUntil: "domcontentloaded" });
  await b.waitForSelector("#auth-email-form", { timeout: 20000 }).catch(() => {});
  await b.waitForTimeout(1500);
  if (!(await b.evaluate(() => !!document.querySelector("#auth-email-form")))) {
    emailProblems.push({ kind: "auth-email", why: "email form not default on both-caps server" });
  } else {
    const email = await probe(b, "#auth-email-input");
    const pass = await probe(b, "#auth-password-input");
    const submit = await probe(b, "#auth-email-submit");
    if (!email || email.hidden || email.type !== "email" || email.ac !== "username")
      emailProblems.push({ kind: "auth-email", why: "email input: " + JSON.stringify(email) });
    if (!pass || pass.hidden || pass.type !== "password" || pass.ac !== "current-password")
      emailProblems.push({ kind: "auth-email", why: "password input: " + JSON.stringify(pass) });
    if (!submit || submit.hidden || submit.h < 44)
      emailProblems.push({ kind: "auth-email", why: "submit target: " + JSON.stringify(submit) });
    await b
      .locator("#auth-email-submit")
      .tap()
      .catch(() => {});
    await b.waitForTimeout(500);
    const err = await b.evaluate(() => {
      const e = document.querySelector(".qr-login-error");
      if (!e || e.hidden || !e.getBoundingClientRect().height) return null;
      return e.textContent.trim();
    });
    if (!err)
      emailProblems.push({ kind: "auth-email", why: "empty submit produced no inline error" });
    if (!(await b.locator(".qr-mode-switch").count())) {
      emailProblems.push({ kind: "auth-email", why: "no inline .qr-mode-switch on touch tier" });
    } else {
      await b.locator(".qr-mode-switch").tap();
      await b.waitForTimeout(1500);
      if (!(await b.evaluate(() => !!document.querySelector("#qr-container"))))
        emailProblems.push({ kind: "auth-email", why: "mode switch did not reach QR view" });
      await b
        .locator(".qr-mode-switch")
        .tap()
        .catch(() => {});
      await b.waitForTimeout(800);
      if (!(await b.evaluate(() => !!document.querySelector("#auth-email-form"))))
        emailProblems.push({ kind: "auth-email", why: "mode switch did not return to email form" });
    }
  }
  await ctxB.close();
  return { qrProblems, emailProblems };
}

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
  const swipeProblems = await swipeGate(page);
  results.push({ label: "home-swipe", ok: swipeProblems.length === 0, fails: swipeProblems });
  console.log(
    `${swipeProblems.length ? "FAIL" : "PASS"} home-swipe${swipeProblems.length ? " " + JSON.stringify(swipeProblems) : ""}`
  );

  const { qrProblems, emailProblems } = await authPhoneGate(browser);
  results.push({ label: "auth-qr-phone", ok: qrProblems.length === 0, fails: qrProblems });
  results.push({ label: "auth-email-form", ok: emailProblems.length === 0, fails: emailProblems });
  console.log(
    `${qrProblems.length ? "FAIL" : "PASS"} auth-qr-phone${qrProblems.length ? " " + JSON.stringify(qrProblems) : ""}`
  );
  console.log(
    `${emailProblems.length ? "FAIL" : "PASS"} auth-email-form${emailProblems.length ? " " + JSON.stringify(emailProblems) : ""}`
  );

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
