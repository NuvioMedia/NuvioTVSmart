import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
let start,
  poll,
  timer,
  qrFails = false;
const qrCalls = [];
const session = {
  url: "https://mdblist.com/device?x=1&y=2",
  completeUrl: "https://mdblist.com/device?code=fixture",
  userCode: "<CODE>",
  interval: 5
};
const fixtures = {
  MdbListTracking: { refresh: async () => false },
  MdbListAccount: { start: () => start(), poll: (...args) => poll(...args) },
  ProfileManager: { getActiveProfileId: () => 1 },
  QrCodeGenerator: {
    generate: (...args) => {
      qrCalls.push(args);
      if (qrFails) throw new Error("canvas unavailable");
    }
  },
  t: (key) => key,
  translateOptionLabel: (option) => option.label,
  escapeHtml,
  escapeAttribute: escapeHtml,
  clamp: (n, min, max) => Math.max(min, Math.min(n, max))
};
const context = vm.createContext({
  fixtures,
  setTimeout: (callback) => {
    timer = callback;
    return 1;
  },
  clearTimeout: () => {
    timer = null;
  }
});
for (const file of ["settingsScreenMethods-02-render-action-row.js", "settingsMdbListAccount.js"]) {
  const source = await readFile(
    new URL(`../js/ui/screens/settings/${file}`, import.meta.url),
    "utf8"
  );
  vm.runInContext(source.replace(/^import .*;\n/gm, "").replace(/export /g, ""), context);
}
vm.runInContext(
  "var internals = fixtures; var { MdbListTracking, MdbListAccount, ProfileManager, QrCodeGenerator, t, escapeHtml, escapeAttribute } = fixtures;",
  context
);
const methods = vm.runInContext("createSettingsScreenMethods02()", context);
const open = vm.runInContext("openMdbListAuthorization", context);
function screen() {
  return {
    ...methods,
    isMounted: true,
    async render() {
      this.markup = this.renderOptionDialog();
      const canvas = {
        remove: () => {
          this.canvasRemoved = true;
        }
      };
      this.optionDialog?.onRender?.({
        querySelector: () => (this.markup.includes("data-mdblist-qr") ? canvas : null)
      });
    }
  };
}
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
start = async () => session;
poll = async () => false;
const s = screen();
open.call(s);
assert.match(s.renderOptionDialog(), /common.loading/);
await flush();
assert.match(s.markup, /mdblist_awaiting_instruction/);
assert.match(s.markup, /data-mdblist-qr/);
assert.match(s.markup, /settings-debrid-auth-qr/);
assert.match(s.markup, /&lt;CODE&gt;/);
assert.match(s.markup, /device\?x=1&amp;y=2/);
assert.doesNotMatch(s.markup, /<CODE>/);
assert.equal(qrCalls[0][1], session.completeUrl);
assert.equal(qrCalls[0][2], 420);
assert.equal(s.focusZone, "dialog");
assert.equal(s.optionDialog.options[0].id, "cancel");
assert.equal(s.optionDialog.returnFocusKey, "integration:mdblist:account");
await timer();
assert(timer, "pending authorization schedules the next poll");
qrFails = true;
await s.render();
assert(s.canvasRemoved);
assert.match(s.markup, /&lt;CODE&gt;/);
assert.match(s.markup, /device\?x=1&amp;y=2/);
s.optionDialog.onClose();
assert.equal(timer, null);
qrFails = false;
start = async () => {
  throw Object.assign(new Error(), { code: "mdblist_unavailable" });
};
const failed = screen();
open.call(failed);
await flush();
assert.match(failed.markup, /mdblist_unavailable/);
assert.doesNotMatch(failed.markup, /data-mdblist-qr/);
let resolveStart;
start = () =>
  new Promise((resolve) => {
    resolveStart = resolve;
  });
const cancelled = screen();
open.call(cancelled);
cancelled.optionDialog.onClose();
resolveStart(session);
await flush();
assert.equal(cancelled.markup, undefined);
assert.equal(timer, null);
console.log(
  "MDBList dialog fixtures passed: instruction, QR, escaped manual code/URL, focus, pending poll, canvas failure, error and cancellation."
);
