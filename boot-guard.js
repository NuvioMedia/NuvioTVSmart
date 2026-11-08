(function installNuvioBootGuard(window, document) {
  "use strict";

  if (typeof window.globalThis === "undefined") {
    window.globalThis = window;
  }

  if (window.NuvioBootGuard) {
    return;
  }

  var OVERLAY_ID = "nuvio-boot-error";
  var COMPATIBILITY_INFO_TIMEOUT_MS = 1500;
  var DEFAULT_COMPATIBILITY_MESSAGES = {
    unsupported_device_title: "TV not supported",
    unsupported_device_message:
      "This TV does not meet the minimum requirements for this version of Nuvio TV.",
    unsupported_device_current_platform: "Current platform",
    unsupported_device_current_firmware: "Current firmware",
    unsupported_device_required_platform: "Required platform",
    unsupported_device_warning:
      "You can try to start Nuvio TV anyway, but the app may not work correctly on this TV. This configuration is not officially supported.",
    unsupported_device_close: "Close",
    unsupported_device_try_anyway: "Try anyway",
    unsupported_device_unavailable: "Unavailable"
  };
  var SUPPORTED_LOCALES = [
    "en",
    "ar",
    "bg",
    "bs",
    "cs",
    "da",
    "de",
    "el",
    "es",
    "es-419",
    "fr",
    "he",
    "hi",
    "hu",
    "id",
    "it",
    "ja",
    "lt",
    "nl",
    "no",
    "pl",
    "pt-br",
    "pt-pt",
    "ro",
    "ru",
    "sk",
    "sl",
    "sr-latn",
    "sq",
    "sv",
    "ta",
    "tr",
    "uk",
    "vi",
    "zh-cn",
    "zh-tw"
  ];
  var active = true;
  var lastStage = "Loading startup files";
  // Time since navigation start when this guard ran, before core-js and the
  // app bundle were fetched and evaluated. The app reads it for boot timing.
  var startedAt =
    window.performance && typeof window.performance.now === "function"
      ? window.performance.now()
      : 0;

  function text(value) {
    if (value === undefined || value === null || value === "") {
      return "Unavailable";
    }
    return String(value);
  }

  function parseJson(value) {
    try {
      return JSON.parse(String(value || "")) || {};
    } catch (ignored) {
      return {};
    }
  }

  function parseMajor(value) {
    var match = String(value || "").match(/^(\d{1,3})/);
    return match ? Number(match[1] || 0) : 0;
  }

  function parseChromeMajor() {
    var userAgent = String((window.navigator && window.navigator.userAgent) || "");
    var match = userAgent.match(/(?:Chrome|Chromium)\/(\d{2,3})/i);
    return match ? Number(match[1] || 0) : 0;
  }

  function mergeDeviceInfo(target, source) {
    var key;
    if (!source) {
      return target;
    }
    for (key in source) {
      if (
        Object.prototype.hasOwnProperty.call(source, key) &&
        source[key] !== undefined &&
        source[key] !== null &&
        source[key] !== ""
      ) {
        target[key] = source[key];
      }
    }
    return target;
  }

  function normalizeLocale(value) {
    var raw = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/_/g, "-");
    var language;
    if (!raw || raw === "system") {
      return "en";
    }
    if (raw === "pt") return "pt-br";
    if (raw === "zh") return "zh-cn";
    if (raw.indexOf("es-419") === 0) return "es-419";
    if (raw.indexOf("pt-br") === 0) return "pt-br";
    if (raw.indexOf("pt-pt") === 0) return "pt-pt";
    if (raw.indexOf("zh-cn") === 0) return "zh-cn";
    if (SUPPORTED_LOCALES.indexOf(raw) !== -1) return raw;
    language = raw.split("-")[0];
    return SUPPORTED_LOCALES.indexOf(language) !== -1 ? language : "en";
  }

  function getStoredLocale() {
    var activeProfileId = "1";
    var settings;
    var storedProfileId;
    try {
      storedProfileId = JSON.parse(window.localStorage.getItem("activeProfileId"));
      if (storedProfileId !== undefined && storedProfileId !== null && storedProfileId !== "") {
        activeProfileId = String(storedProfileId);
      }
      settings = JSON.parse(window.localStorage.getItem("themeSettings"));
      if (settings && settings.__profileScoped && settings.profiles) {
        settings = settings.profiles[activeProfileId] || settings.profiles["1"] || null;
      }
      return settings && settings.language ? normalizeLocale(settings.language) : "";
    } catch (ignored) {
      return "";
    }
  }

  function getPreferredLocale() {
    var stored = getStoredLocale();
    var languages;
    if (stored) {
      return stored;
    }
    languages = window.navigator && window.navigator.languages;
    if (languages && languages.length) {
      return normalizeLocale(languages[0]);
    }
    return normalizeLocale(window.navigator && window.navigator.language);
  }

  function parseMessagesXml(source) {
    var messages = {};
    var parser;
    var xml;
    var nodes;
    var index;
    var name;
    if (typeof window.DOMParser !== "function") {
      return messages;
    }
    try {
      parser = new window.DOMParser();
      xml = parser.parseFromString(String(source || ""), "application/xml");
      nodes = xml.getElementsByTagName("string");
      for (index = 0; index < nodes.length; index += 1) {
        name = String(nodes[index].getAttribute("name") || "");
        if (Object.prototype.hasOwnProperty.call(DEFAULT_COMPATIBILITY_MESSAGES, name)) {
          messages[name] = String(nodes[index].textContent || "").replace(/\\'/g, "'");
        }
      }
    } catch (ignored) {}
    return messages;
  }

  function loadCompatibilityMessages(callback) {
    var locale = getPreferredLocale();
    var path = locale === "en" ? "res/values/strings.xml" : "res/values-" + locale + "/strings.xml";
    var xhr;
    var done = false;
    var timeoutId = 0;

    function finish(localized) {
      if (done) {
        return;
      }
      done = true;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      callback(mergeDeviceInfo(mergeDeviceInfo({}, DEFAULT_COMPATIBILITY_MESSAGES), localized));
    }

    if (typeof window.XMLHttpRequest !== "function") {
      finish({});
      return;
    }

    try {
      xhr = new window.XMLHttpRequest();
      xhr.open("GET", path, true);
      xhr.onreadystatechange = function onMessagesLoaded() {
        if (xhr.readyState !== 4) {
          return;
        }
        if (xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) {
          finish(parseMessagesXml(xhr.responseText));
        } else {
          finish({});
        }
      };
      xhr.onerror = function onMessagesError() {
        finish({});
      };
      timeoutId = window.setTimeout(function onMessagesTimeout() {
        finish({});
      }, COMPATIBILITY_INFO_TIMEOUT_MS);
      xhr.send(null);
    } catch (ignored) {
      finish({});
    }
  }

  function formatPlatform(info) {
    var label = info.platform === "tizen" ? "Samsung Tizen" : "LG webOS";
    var version = info.platformVersion ? " " + info.platformVersion : "";
    var engine = info.chromeMajor ? " · Chromium " + info.chromeMajor : "";
    var model = info.modelName ? " · " + info.modelName : "";
    return label + version + engine + model;
  }

  function exitUnsupportedApp(platform) {
    try {
      if (platform === "webos") {
        if (window.webOSSystem && typeof window.webOSSystem.close === "function") {
          window.webOSSystem.close();
          return;
        }
        if (window.PalmSystem && typeof window.PalmSystem.close === "function") {
          window.PalmSystem.close();
          return;
        }
      }
      if (
        platform === "tizen" &&
        window.tizen &&
        window.tizen.application &&
        typeof window.tizen.application.getCurrentApplication === "function"
      ) {
        window.tizen.application.getCurrentApplication().exit();
        return;
      }
      if (typeof window.close === "function") {
        window.close();
      }
    } catch (ignored) {}
  }

  function canOfferTryAnyway(info, options) {
    var minChrome = Number(options.minChrome || 0);
    if (!minChrome) {
      return true;
    }
    // The bundle is compiled for minChrome: older engines fail to parse it
    // before the app starts, so there is nothing the bypass could launch.
    return info.chromeMajor >= minChrome;
  }

  function bindBootButtonFocus(button) {
    function paint(focused) {
      button.style.background = focused ? "#ffffff" : "#242424";
      button.style.color = focused ? "#121212" : "#ffffff";
      button.style.borderColor = focused ? "#ffffff" : "#767676";
      button.style.transform = focused ? "scale(1.1)" : "scale(1)";
    }

    // Matches the Android TV dialog button focus treatment.
    button.style.transition =
      "background 200ms cubic-bezier(0.4, 0, 0.2, 1), " +
      "color 200ms cubic-bezier(0.4, 0, 0.2, 1), " +
      "transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1)";
    paint(false);
    button.onfocus = function onBootButtonFocus() {
      paint(true);
    };
    button.onblur = function onBootButtonBlur() {
      paint(false);
    };
  }

  function showUnsupportedDevice(info, options, messages, onTryAnyway) {
    var overlay;
    var card;
    var logo;
    var title;
    var description;
    var warning;
    var details;
    var rows;
    var index;
    var row;
    var label;
    var value;
    var actions;
    var close;
    var tryAnyway = null;
    var allowTryAnyway = canOfferTryAnyway(info, options);
    var bypassStarted = false;

    if (!document.body) {
      return;
    }

    removeOverlay();

    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.setAttribute("role", "alert");
    overlay.setAttribute("dir", info.locale === "ar" || info.locale === "he" ? "rtl" : "ltr");
    overlay.style.cssText =
      "position:fixed;z-index:2147483647;left:0;top:0;width:100%;height:100%;" +
      "box-sizing:border-box;background:#0d0d0d;color:#f5f5f5;font-family:Arial,sans-serif;" +
      "display:flex;align-items:center;justify-content:center;padding:64px;";

    card = document.createElement("div");
    card.style.cssText = "width:100%;max-width:1050px;text-align:center;";

    logo = document.createElement("img");
    logo.src = "assets/brand/app_logo_wordmark.png";
    logo.alt = "Nuvio";
    logo.style.cssText = "display:block;width:240px;max-width:38vw;height:auto;margin:0 auto 34px;";

    title = document.createElement("div");
    title.style.cssText = "font-size:44px;line-height:1.15;font-weight:700;margin-bottom:20px;";
    title.textContent = messages.unsupported_device_title;

    description = document.createElement("div");
    description.style.cssText =
      "font-size:25px;line-height:1.45;color:#c9c9c9;margin:0 auto 30px;max-width:900px;";
    description.textContent = messages.unsupported_device_message;

    if (allowTryAnyway) {
      warning = document.createElement("div");
      warning.style.cssText =
        "font-size:21px;line-height:1.45;color:#f0c674;margin:0 auto 30px;max-width:900px;";
      warning.textContent = messages.unsupported_device_warning;
    }
    details = document.createElement("div");
    details.style.cssText =
      "box-sizing:border-box;text-align:left;background:#181818;border:1px solid #343434;" +
      "border-radius:18px;padding:10px 28px;margin:0 auto 32px;max-width:960px;";

    rows = [
      [messages.unsupported_device_current_platform, formatPlatform(info)],
      [
        messages.unsupported_device_current_firmware,
        info.firmwareVersion || messages.unsupported_device_unavailable
      ],
      [messages.unsupported_device_required_platform, options.requiredLabel]
    ];

    for (index = 0; index < rows.length; index += 1) {
      row = document.createElement("div");
      row.style.cssText =
        "display:flex;align-items:flex-start;justify-content:space-between;padding:18px 0;" +
        (index ? "border-top:1px solid #303030;" : "");
      label = document.createElement("div");
      label.style.cssText = "font-size:20px;line-height:1.35;color:#a9a9a9;padding-right:28px;";
      label.textContent = rows[index][0];
      value = document.createElement("div");
      value.style.cssText = "font-size:21px;line-height:1.35;font-weight:700;text-align:right;";
      value.textContent = rows[index][1];
      row.appendChild(label);
      row.appendChild(value);
      details.appendChild(row);
    }

    close = document.createElement("button");
    close.type = "button";
    close.textContent = messages.unsupported_device_close;
    close.style.cssText =
      "min-width:230px;padding:17px 30px;border:2px solid #767676;border-radius:12px;" +
      "background:#242424;color:#ffffff;font-size:23px;font-weight:700;outline:none;";
    bindBootButtonFocus(close);
    close.onclick = function closeUnsupportedApp() {
      exitUnsupportedApp(info.platform);
    };
    close.onkeydown = function closeUnsupportedAppWithRemote(event) {
      if (handleUnsupportedActionNavigation(event, close)) {
        return;
      }
      var keyCode = Number(event && event.keyCode);
      var key = String((event && event.key) || "");
      if (key === "Enter" || key === "OK" || keyCode === 13) {
        if (event && typeof event.preventDefault === "function") {
          event.preventDefault();
        }
        exitUnsupportedApp(info.platform);
      }
    };

    if (allowTryAnyway) {
      tryAnyway = document.createElement("button");
      tryAnyway.type = "button";
      tryAnyway.textContent = messages.unsupported_device_try_anyway;
      tryAnyway.style.cssText =
        "min-width:300px;padding:17px 30px;border:2px solid #767676;border-radius:12px;" +
        "background:#242424;color:#ffffff;font-size:23px;font-weight:700;outline:none;";
      bindBootButtonFocus(tryAnyway);

      tryAnyway.onclick = startUnsupportedAppAnyway;
      tryAnyway.onkeydown = function startUnsupportedAppAnywayWithRemote(event) {
        if (handleUnsupportedActionNavigation(event, tryAnyway)) {
          return;
        }
        var keyCode = Number(event && event.keyCode);
        var key = String((event && event.key) || "");
        if (key === "Enter" || key === "OK" || keyCode === 13) {
          if (event && typeof event.preventDefault === "function") {
            event.preventDefault();
          }
          startUnsupportedAppAnyway();
        }
      };
    }

    function focusUnsupportedAction(button) {
      if (!button || typeof button.focus !== "function") {
        return;
      }
      try {
        button.focus();
      } catch (ignored) {}
    }

    function moveUnsupportedActionFocus(currentButton, direction) {
      var nextButton = currentButton;
      if (currentButton === close && direction > 0) {
        nextButton = tryAnyway;
      } else if (currentButton === tryAnyway && direction < 0) {
        nextButton = close;
      }
      if (nextButton !== currentButton) {
        focusUnsupportedAction(nextButton);
      }
    }

    function handleUnsupportedActionNavigation(event, currentButton) {
      var keyCode = Number(event && (event.keyCode || event.which || 0));
      var key = String((event && event.key) || "").toLowerCase();
      var keyName = String(
        (event && event.keyName) || (event && event.detail && event.detail.keyName) || ""
      ).toLowerCase();
      var code = String((event && event.code) || "").toLowerCase();
      var direction = 0;
      var names = [key, keyName, code];

      if (
        keyCode === 39 ||
        keyCode === 40 ||
        names.indexOf("arrowright") !== -1 ||
        names.indexOf("right") !== -1 ||
        names.indexOf("dpadright") !== -1 ||
        names.indexOf("dpad_right") !== -1 ||
        names.indexOf("arrowdown") !== -1 ||
        names.indexOf("down") !== -1 ||
        names.indexOf("dpaddown") !== -1 ||
        names.indexOf("dpad_down") !== -1
      ) {
        direction = 1;
      } else if (
        keyCode === 37 ||
        keyCode === 38 ||
        names.indexOf("arrowleft") !== -1 ||
        names.indexOf("left") !== -1 ||
        names.indexOf("dpadleft") !== -1 ||
        names.indexOf("dpad_left") !== -1 ||
        names.indexOf("arrowup") !== -1 ||
        names.indexOf("up") !== -1 ||
        names.indexOf("dpadup") !== -1 ||
        names.indexOf("dpad_up") !== -1
      ) {
        direction = -1;
      }

      if (!direction) {
        return false;
      }

      if (event && typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      if (event && typeof event.stopPropagation === "function") {
        event.stopPropagation();
      }
      moveUnsupportedActionFocus(currentButton, direction);
      return true;
    }

    function startUnsupportedAppAnyway() {
      if (bypassStarted) {
        return;
      }
      bypassStarted = true;
      active = true;
      // Keep this opt-in in memory only so the gate is shown again after reload.
      window.__NUVIO_COMPATIBILITY_BYPASSED__ = true;
      removeOverlay();
      if (typeof onTryAnyway === "function") {
        onTryAnyway();
      }
    }

    actions = document.createElement("div");
    actions.style.cssText =
      "display:flex;align-items:center;justify-content:center;gap:32px;flex-wrap:wrap;";

    card.appendChild(logo);
    card.appendChild(title);
    card.appendChild(description);
    if (warning) {
      card.appendChild(warning);
    }
    card.appendChild(details);
    actions.appendChild(close);
    if (tryAnyway) {
      actions.appendChild(tryAnyway);
    }
    card.appendChild(actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    document.documentElement.lang = info.locale;
    active = false;

    try {
      close.focus();
    } catch (ignored) {}
  }

  function readWebOsInfo() {
    var palmInfo = parseJson(window.PalmSystem && window.PalmSystem.deviceInfo);
    var firmwareVersion =
      palmInfo.firmwareVersion ||
      palmInfo.platformVersion ||
      (palmInfo.platformVersionMajor
        ? String(palmInfo.platformVersionMajor) + "." + String(palmInfo.platformVersionMinor || 0)
        : "");
    var platformVersion = palmInfo.sdkVersion || "";
    return {
      platform: "webos",
      platformVersion: platformVersion,
      platformMajor: parseMajor(platformVersion),
      firmwareVersion: firmwareVersion,
      modelName: palmInfo.modelName || "",
      chromeMajor: parseChromeMajor()
    };
  }

  function enrichWebOsInfo(info, callback) {
    var finished = false;
    var timeoutId = 0;

    function finish(details) {
      if (finished) {
        return;
      }
      finished = true;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      if (details) {
        info.platformVersion = details.sdkVersion || info.platformVersion;
        info.platformMajor = parseMajor(info.platformVersion) || info.platformMajor;
        info.firmwareVersion = details.version || details.firmwareVersion || info.firmwareVersion;
        info.modelName = details.modelName || info.modelName;
      }
      callback(info);
    }

    if (!window.webOS || typeof window.webOS.deviceInfo !== "function") {
      finish(null);
      return;
    }

    timeoutId = window.setTimeout(function onWebOsInfoTimeout() {
      finish(null);
    }, COMPATIBILITY_INFO_TIMEOUT_MS);

    try {
      window.webOS.deviceInfo(function onWebOsDeviceInfo(details) {
        finish(details || null);
      });
    } catch (ignored) {
      finish(null);
    }
  }

  function readTizenInfo(includeDeviceDetails) {
    var platformVersion = "";
    var firmwareVersion = "";
    var modelName = "";
    try {
      if (window.tizen && window.tizen.systeminfo) {
        platformVersion = String(
          window.tizen.systeminfo.getCapability("http://tizen.org/feature/platform.version") || ""
        );
      }
    } catch (ignored) {}
    if (includeDeviceDetails) {
      try {
        if (window.webapis && window.webapis.productinfo) {
          firmwareVersion = String(window.webapis.productinfo.getFirmware() || "");
          modelName = String(window.webapis.productinfo.getModel() || "");
        }
      } catch (ignored) {}
    }
    if (!platformVersion) {
      platformVersion =
        (String((window.navigator && window.navigator.userAgent) || "").match(
          /Tizen[\s\/]([0-9.]+)/i
        ) || [])[1] || "";
    }
    return {
      platform: "tizen",
      platformVersion: platformVersion,
      platformMajor: parseMajor(platformVersion),
      firmwareVersion: firmwareVersion,
      modelName: modelName,
      chromeMajor: parseChromeMajor()
    };
  }

  function compatibilityDecision(info, options) {
    var minVersion = Number(options.minVersion || 0);
    var minChrome = Number(options.minChrome || 0);
    var hasPlatformVersion = info.platformMajor > 0 && minVersion > 0;
    var hasChromeVersion = info.chromeMajor > 0 && minChrome > 0;
    if (
      (hasPlatformVersion && info.platformMajor < minVersion) ||
      (hasChromeVersion && info.chromeMajor < minChrome)
    ) {
      return "unsupported";
    }
    if (hasPlatformVersion || hasChromeVersion) {
      return "supported";
    }
    return "unknown";
  }

  function runCompatibilityGate(options, onSupported) {
    var info;
    var decision;
    var locale = getPreferredLocale();

    function renderUnsupported(resolvedInfo) {
      resolvedInfo.locale = locale;
      loadCompatibilityMessages(function onCompatibilityMessages(messages) {
        showUnsupportedDevice(resolvedInfo, options, messages, onSupported);
      });
    }

    if (!options || (options.platform !== "webos" && options.platform !== "tizen")) {
      onSupported();
      return;
    }

    if (options.platform === "tizen") {
      // ProductInfo is only used to enrich the unsupported-device screen.
      // Avoid invoking Samsung's optional ProductInfo methods on supported
      // devices, where some firmware logs a misleading numeric status.
      info = readTizenInfo(false);
      decision = compatibilityDecision(info, options);
      if (decision === "unsupported") {
        renderUnsupported(readTizenInfo(true));
        return;
      }
      onSupported();
      return;
    }

    info = readWebOsInfo();
    decision = compatibilityDecision(info, options);
    if (decision === "supported") {
      onSupported();
      return;
    }
    enrichWebOsInfo(info, function onWebOsInfo(resolvedInfo) {
      if (compatibilityDecision(resolvedInfo, options) === "unsupported") {
        renderUnsupported(resolvedInfo);
      } else {
        onSupported();
      }
    });
  }

  function loadScript(source) {
    var script = document.createElement("script");
    script.async = false;
    script.defer = false;
    script.src = source;
    script.onerror = function handleStartupScriptError() {
      guard.scriptFailed(source);
    };
    guard.stage("Loading " + source);
    document.body.appendChild(script);
  }

  function removeOverlay() {
    var overlay = document.getElementById(OVERLAY_ID);
    if (overlay && overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
  }

  function showError(message, details, code) {
    if (!active || !document.body) {
      return;
    }

    removeOverlay();

    var overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.setAttribute("role", "alert");
    overlay.style.cssText =
      "position:fixed;z-index:2147483647;left:0;top:0;width:100%;height:100%;" +
      "box-sizing:border-box;background:#0d0d0d;color:#f5f5f5;font-family:Arial,sans-serif;" +
      "display:flex;align-items:center;justify-content:center;padding:64px;";

    var card = document.createElement("div");
    card.style.cssText = "width:100%;max-width:1120px;text-align:center;";

    var title = document.createElement("div");
    title.style.cssText = "font-size:44px;line-height:1.15;font-weight:700;margin-bottom:22px;";
    title.textContent = "Nuvio TV could not start";

    var description = document.createElement("div");
    description.style.cssText =
      "font-size:25px;line-height:1.45;color:#c9c9c9;margin:0 auto 30px;max-width:920px;";
    description.textContent = text(message);

    var diagnostic = document.createElement("div");
    diagnostic.style.cssText =
      "box-sizing:border-box;text-align:left;white-space:pre-wrap;word-break:break-word;" +
      "font-family:monospace;font-size:19px;line-height:1.45;color:#dddddd;background:#181818;" +
      "border:1px solid #343434;border-radius:14px;padding:22px 26px;margin:0 auto 32px;max-width:980px;";
    diagnostic.textContent =
      "Code: " +
      text(code || "BOOT-ERROR") +
      "\n" +
      "Stage: " +
      text(lastStage) +
      "\n" +
      "Details: " +
      text(details);

    var retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Retry";
    retry.style.cssText =
      "min-width:190px;padding:17px 30px;border:2px solid #767676;border-radius:12px;" +
      "background:#242424;color:#ffffff;font-size:23px;font-weight:700;outline:none;";
    bindBootButtonFocus(retry);
    retry.onclick = function retryBoot() {
      window.location.reload();
    };
    retry.onkeydown = function retryBootWithRemote(event) {
      var keyCode = Number(event && event.keyCode);
      var key = String((event && event.key) || "");
      if (key === "Enter" || key === "OK" || keyCode === 13) {
        window.location.reload();
      }
    };

    card.appendChild(title);
    card.appendChild(description);
    card.appendChild(diagnostic);
    card.appendChild(retry);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    try {
      retry.focus();
    } catch (ignored) {}
  }

  function formatRuntimeError(message, source, line, column, error) {
    var parts = [];
    var errorText = error && (error.stack || error.message);
    if (errorText) {
      parts.push(String(errorText));
    } else if (message) {
      parts.push(String(message));
    }
    if (source) {
      parts.push(String(source) + ":" + Number(line || 0) + ":" + Number(column || 0));
    }
    return parts.join("\n");
  }

  var guard = {
    startedAt: startedAt,

    stage: function stage(name) {
      if (active && name) {
        lastStage = String(name);
      }
    },

    fail: function fail(message, details, code) {
      showError(message, details, code);
    },

    scriptFailed: function scriptFailed(source) {
      showError("A required startup file could not be loaded.", text(source), "BOOT-ASSET");
    },

    ready: function ready() {
      active = false;
      removeOverlay();
    },

    runCompatibilityGate: runCompatibilityGate,

    loadScript: loadScript,

    isActive: function isActive() {
      return active;
    }
  };

  window.NuvioBootGuard = guard;

  var previousOnError = window.onerror;
  window.onerror = function onBootError(message, source, line, column, error) {
    if (active) {
      showError(
        "Something went wrong while the application was starting.",
        formatRuntimeError(message, source, line, column, error),
        "BOOT-RUNTIME"
      );
    }
    if (typeof previousOnError === "function") {
      return previousOnError.apply(window, arguments);
    }
    return false;
  };

  if (typeof window.addEventListener === "function") {
    window.addEventListener("unhandledrejection", function onBootRejection(event) {
      var reason = event && event.reason;
      if (active) {
        showError(
          "Something went wrong while the application was starting.",
          reason && (reason.stack || reason.message) ? reason.stack || reason.message : reason,
          "BOOT-PROMISE"
        );
      }
    });
  }
})(window, document);
