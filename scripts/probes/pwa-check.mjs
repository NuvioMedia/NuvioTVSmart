// PWA shell gate for the mobile-web tier: manifest wiring + parsing, service
// worker registration at root scope, and the offline-boot fallback. The
// worker is browser-tier only (index.html skips Tizen/webOS UAs), so this
// checks the browser contract. BASE_URL env overrides the server origin.
import { chromium } from "playwright";

const BASE_URL = (process.env.BASE_URL || "http://127.0.0.1:4173").replace(/\/+$/, "");
const problems = [];
const check = (ok, label, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : " " + detail}`);
  if (!ok) problems.push(label);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true
});
const page = await ctx.newPage();
await page.goto(BASE_URL + "/", { waitUntil: "domcontentloaded" });
await page.waitForLoadState("load");

const manifest = await page.evaluate(async () => {
  const link = document.querySelector('link[rel="manifest"]');
  if (!link) return { link: false };
  const res = await fetch(link.href);
  if (!res.ok) return { link: true, manifestStatus: res.status };
  const json = await res.json();
  const icons = [];
  for (const ic of json.icons || [])
    icons.push((await fetch(new URL(ic.src, link.href).href)).status);
  return {
    link: true,
    display: json.display,
    start: json.start_url,
    icons,
    themeColor: document.querySelector('meta[name="theme-color"]')?.content || null,
    viewportFit: (
      document.querySelector('meta[name="viewport"]')?.getAttribute("content") || ""
    ).includes("viewport-fit=cover")
  };
});
check(
  manifest.link &&
    manifest.display === "standalone" &&
    (manifest.icons || []).every((s) => s === 200) &&
    manifest.themeColor &&
    manifest.viewportFit,
  "manifest",
  JSON.stringify(manifest)
);

const reg = await page.evaluate(async () => {
  for (let i = 0; i < 40; i++) {
    const r = await navigator.serviceWorker.getRegistration();
    if (r && r.active) return { active: true, scope: r.scope };
    await new Promise((res) => setTimeout(res, 500));
  }
  return { active: false };
});
check(reg.active && reg.scope === BASE_URL + "/", "service-worker", JSON.stringify(reg));

await page.waitForTimeout(3000); // let install precache finish
await ctx.setOffline(true);
const offline = await page
  .goto(BASE_URL + "/", { waitUntil: "domcontentloaded" })
  .catch((e) => ({ err: String(e).slice(0, 80) }));
if (offline.err) {
  check(false, "offline-boot", offline.err);
} else {
  await page.waitForTimeout(1500);
  const booted = await page.evaluate(() => ({
    swControlled: navigator.serviceWorker.controller != null,
    hasAppMarkup: Boolean(document.querySelector(".screen, #detail, .home-shell"))
  }));
  check(booted.swControlled && booted.hasAppMarkup, "offline-boot", JSON.stringify(booted));
}

await browser.close();
console.log(
  `\n${problems.length ? problems.length + " PWA checks failed: " + problems.join(", ") : "all PWA checks pass"}`
);
process.exit(problems.length ? 1 : 0);
