import { LayoutPreferences } from "../data/local/layoutPreferences.js";

export const FAST_HORIZONTAL_NAVIGATION_KEY = "fastHorizontalNavigationEnabled";

export function getArrowCodeFromKey(key) {
  if (key === "ArrowUp" || key === "Up") return 38;
  if (key === "ArrowDown" || key === "Down") return 40;
  if (key === "ArrowLeft" || key === "Left") return 37;
  if (key === "ArrowRight" || key === "Right") return 39;
  return null;
}

function getKeyCodeFromName(keyName) {
  const normalized = String(keyName || "").toLowerCase();
  const keyMap = {
    arrowup: 38,
    up: 38,
    dpadup: 38,
    dpad_up: 38,
    arrowdown: 40,
    down: 40,
    dpaddown: 40,
    dpad_down: 40,
    arrowleft: 37,
    left: 37,
    dpadleft: 37,
    dpad_left: 37,
    arrowright: 39,
    right: 39,
    dpadright: 39,
    dpad_right: 39,
    ok: 13,
    select: 13,
    enter: 13,
    dpadcenter: 13,
    dpad_center: 13,
    center: 13,
    back: 10009,
    goback: 10009,
    browserback: 10009,
    xf86back: 10009,
    // Samsung TV reports the remote Enter/OK key as keyName "Return".
    // The actual Back key is exposed as Back/XF86Back (keyCode 10009).
    return: 13,
    mediaplaypause: 10252,
    mediaplay: 415,
    mediapause: 19,
    mediastop: 413,
    mediafastforward: 417,
    mediarewind: 412,
    mediatracknext: 176,
    mediatrackprevious: 177,
    colorf2yellow: 405,
    yellow: 405
  };
  return keyMap[normalized] || 0;
}

function isMediaKeyEvent(event, normalizedCode = null) {
  const key = String(event?.key || "").toLowerCase();
  const keyName = String(event?.keyName || event?.detail?.keyName || "").toLowerCase();
  const code = String(event?.code || "").toLowerCase();
  const rawCode = Number(event?.originalKeyCode || event?.keyCode || event?.which || 0);
  const effectiveCode = Number(normalizedCode || rawCode || 0);
  const mediaNames = new Set([
    "mediaplaypause",
    "mediaplay",
    "mediapause",
    "mediastop",
    "mediafastforward",
    "mediarewind",
    "mediatracknext",
    "mediatrackprevious",
    "play",
    "pause"
  ]);
  if (mediaNames.has(key) || mediaNames.has(keyName) || mediaNames.has(code)) {
    return true;
  }
  return (
    [179, 10252, 415, 19, 413, 178, 417, 412, 176, 177].includes(effectiveCode) ||
    [179, 10252, 415, 19, 413, 178, 417, 412, 176, 177].includes(rawCode)
  );
}

function isEditableTarget(target) {
  const tagName = String(target?.tagName || "").toUpperCase();
  return Boolean(
    target?.isContentEditable ||
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT"
  );
}

function isSimulator() {
  const ua = String(globalThis.navigator?.userAgent || "").toLowerCase();
  return ua.includes("simulator");
}

export function shouldUseRotatedMapping() {
  return isSimulator();
}

export function isFastHorizontalNavigationEnabled() {
  return Boolean(LayoutPreferences.get().fastHorizontalNavigationEnabled);
}

export function normalizeDirectionalKeyCode(code) {
  const rotatedMap = {
    37: 38,
    38: 37,
    39: 40,
    40: 39
  };
  if (shouldUseRotatedMapping() && rotatedMap[code]) {
    return rotatedMap[code];
  }
  return code;
}

export function normalizeKeyEvent(event, backCodes = []) {
  const key = String(event?.key || "");
  const keyName = String(event?.keyName || event?.detail?.keyName || "");
  const code = String(event?.code || "");
  const keyNameLower = keyName.toLowerCase();
  const fallbackCode =
    getKeyCodeFromName(keyName) || getKeyCodeFromName(key) || getKeyCodeFromName(code);
  const rawCode = Number(
    getArrowCodeFromKey(key) || event?.keyCode || event?.which || fallbackCode || 0
  );
  const selectCode = rawCode === 23 ? 13 : rawCode;
  const normalizedCode = normalizeDirectionalKeyCode(selectCode);
  const isBack = isBackEvent(event, backCodes, normalizedCode);
  return {
    key: key || (keyNameLower === "back" ? "Back" : keyName),
    code,
    keyName,
    keyCode: normalizedCode,
    originalKeyCode: rawCode,
    isArrow: normalizedCode >= 37 && normalizedCode <= 40,
    isEnter: normalizedCode === 13 || key === "Enter",
    isBack
  };
}

export function isBackEvent(event, backCodes = [], normalizedCode = null) {
  const target = event?.target || null;
  const key = String(event?.key || "");
  const keyLower = key.toLowerCase();
  const keyName = String(event?.keyName || event?.detail?.keyName || "");
  const keyNameLower = keyName.toLowerCase();
  const code = String(event?.code || "");
  const rawCode = Number(event?.keyCode || event?.which || 0);
  const effectiveCode = Number(normalizedCode || rawCode || 0);

  if (
    isEditableTarget(target) &&
    (key === "Backspace" || rawCode === 8 || key === "Delete" || rawCode === 46)
  ) {
    return false;
  }

  if (isMediaKeyEvent(event, effectiveCode)) {
    return false;
  }

  if (["back", "goback", "browserback", "xf86back"].includes(keyNameLower)) {
    return true;
  }

  if (backCodes.includes(effectiveCode) || backCodes.includes(rawCode)) {
    return true;
  }

  if (
    key === "Escape" ||
    key === "Esc" ||
    key === "Backspace" ||
    key === "GoBack" ||
    key === "XF86Back" ||
    code === "BrowserBack" ||
    code === "GoBack"
  ) {
    return true;
  }

  return keyLower.includes("back");
}
