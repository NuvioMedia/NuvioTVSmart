// webOS 5 (Chromium 68) Intl time-zone shim.
// On webOS 5 the browser's ICU cannot resolve the default host time zone, so any
// localized date/time call (Date.toLocale* / Intl.DateTimeFormat with no explicit
// timeZone) throws:
//   RangeError: Unsupported time zone specified undefined
// The OS UTC offset and an explicit timeZone:'UTC' both work, so correct *local*
// time is rendered by shifting the timestamp into UTC. The shim only activates
// when the default zone is actually broken, so it is a no-op on other runtimes.
// Same approach as jellyfin/jellyfin-webos#354.
(function () {
  var defaultTZBroken = false;
  try {
    new Date().toLocaleTimeString("en-US", { hour: "numeric" });
  } catch (e) {
    defaultTZBroken = true;
  }
  if (!defaultTZBroken) {
    return;
  }

  function assign(target, src) {
    if (src) {
      for (var k in src) {
        if (Object.prototype.hasOwnProperty.call(src, k)) {
          target[k] = src[k];
        }
      }
    }
    return target;
  }
  // Returns a Date whose UTC fields equal this date's local wall-clock time,
  // so formatting it as UTC yields the correct local time string.
  function toWallClockUTC(d) {
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  }
  function withUTC(options) {
    return assign(assign({}, options), { timeZone: "UTC" });
  }
  function hasTZ(options) {
    return options != null && options.timeZone != null;
  }

  function patchDateMethod(name) {
    var orig = Date.prototype[name];
    Date.prototype[name] = function (locales, options) {
      if (hasTZ(options)) {
        return orig.call(this, locales, options);
      }
      return orig.call(toWallClockUTC(this), locales, withUTC(options));
    };
  }
  patchDateMethod("toLocaleTimeString");
  patchDateMethod("toLocaleDateString");
  patchDateMethod("toLocaleString");

  if (typeof Intl !== "undefined" && Intl.DateTimeFormat) {
    var OrigDTF = Intl.DateTimeFormat;
    var Patched = function DateTimeFormat(locales, options) {
      if (hasTZ(options)) {
        return new OrigDTF(locales, options);
      }
      var f = new OrigDTF(locales, withUTC(options));
      var toDate = function (d) {
        if (d == null) {
          d = new Date();
        } else if (!(d instanceof Date)) {
          d = new Date(d);
        }
        return toWallClockUTC(d);
      };
      return {
        format: function (d) { return f.format(toDate(d)); },
        formatToParts: function (d) { return f.formatToParts(toDate(d)); },
        resolvedOptions: function () { return f.resolvedOptions(); }
      };
    };
    Patched.prototype = OrigDTF.prototype;
    Patched.supportedLocalesOf = function (locales, options) {
      return OrigDTF.supportedLocalesOf(locales, options);
    };
    Intl.DateTimeFormat = Patched;
  }
})();
