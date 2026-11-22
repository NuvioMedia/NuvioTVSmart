import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shimSource = await readFile(
  path.join(rootDir, "assets", "runtime", "webos-timezone-shim.js"),
  "utf8"
);

// Fresh realm whose ICU behaves like webOS 5: formatting without an explicit timeZone throws.
function brokenWebOsRealm() {
  const context = vm.createContext({});
  vm.runInContext(
    `
    (function () {
      var err = function () { throw new RangeError("Unsupported time zone specified undefined"); };
      ["toLocaleTimeString", "toLocaleDateString", "toLocaleString"].forEach(function (name) {
        var orig = Date.prototype[name];
        Date.prototype[name] = function (locales, options) {
          if (!options || options.timeZone == null) err();
          return orig.call(this, locales, options);
        };
      });
      var OrigDTF = Intl.DateTimeFormat;
      Intl.DateTimeFormat = function (locales, options) {
        if (!options || options.timeZone == null) err();
        return new OrigDTF(locales, options);
      };
    })();
  `,
    context
  );
  return context;
}

test("webOS 5: localized date/time calls without timeZone stop throwing and show local wall-clock time", () => {
  const context = brokenWebOsRealm();
  assert.throws(
    () => vm.runInContext("new Date().toLocaleDateString('en-US')", context),
    /Unsupported time zone/
  );

  vm.runInContext(shimSource, context);

  const result = vm.runInContext(
    `
    var d = new Date(2026, 10, 21, 20, 5);
    ({
      date: d.toLocaleDateString("en-US"),
      time: d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      dtf: new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(d),
      explicit: d.toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric" })
    })
  `,
    context
  );
  assert.equal(result.date, "11/21/2026");
  assert.equal(result.time, "20:05");
  assert.equal(result.dtf, "20:05");
  assert.equal(result.explicit, "2026");
});

test("working runtimes are left untouched", () => {
  const context = vm.createContext({});
  const before = vm.runInContext(
    "[Date.prototype.toLocaleDateString, Intl.DateTimeFormat]",
    context
  );
  vm.runInContext(shimSource, context);
  const after = vm.runInContext(
    "[Date.prototype.toLocaleDateString, Intl.DateTimeFormat]",
    context
  );
  assert.equal(after[0], before[0]);
  assert.equal(after[1], before[1]);
});
