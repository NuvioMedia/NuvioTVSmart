// Philips Titan OS browsers turn the remote D-pad into a mouse pointer, so the
// arrows and OK never reach the page as keys. The number pad still does, which
// is enough to drive the same focus engine Android TV uses.
// shortcut: only the remote's number-pad mode is usable; arrow mode stays a
// pointer, revisit if Titan exposes native D-pad keys.
const TITAN_OS_UA_PATTERN = /TitanOS\//i;

const SHIM_FLAG = "__nuvioTitanKey";

const DIGIT_TO_KEY = {
  2: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  8: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  4: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  6: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  5: { key: "Enter", code: "Enter", keyCode: 13 },
  0: { key: "Escape", code: "Escape", keyCode: 27 }
};

export function isTitanOsUserAgent(userAgent) {
  return TITAN_OS_UA_PATTERN.test(String(userAgent || ""));
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

function readDigit(event) {
  const key = String(event?.key || "");
  if (/^\d$/.test(key)) {
    return key;
  }
  const keyCode = Number(event?.keyCode || event?.which || 0);
  if (keyCode >= 48 && keyCode <= 57) {
    return String(keyCode - 48);
  }
  const codeName = String(event?.code || "");
  const match = codeName.match(/(?:Digit|Numpad)(\d)$/);
  return match ? match[1] : "";
}

function withKeyCode(event, keyCode) {
  // Chromium ignores keyCode in the KeyboardEvent init dictionary, but screen
  // handlers still read it.
  if (Number(event.keyCode) === keyCode) {
    return event;
  }
  try {
    Object.defineProperty(event, "keyCode", { get: () => keyCode });
    Object.defineProperty(event, "which", { get: () => keyCode });
  } catch (_) {}
  return event;
}

export function installTitanRemote(win = globalThis) {
  const doc = win?.document;
  if (!win?.addEventListener || !doc) {
    return false;
  }

  const translate = (event) => {
    if (!event || event[SHIM_FLAG] || isEditableTarget(event.target)) {
      return;
    }
    if (event.key === "Backspace" || Number(event.keyCode || 0) === 8) {
      // Opera TV runs history.back() on Back unless the default is cancelled.
      event.preventDefault?.();
      return;
    }
    const spec = DIGIT_TO_KEY[readDigit(event)];
    if (!spec || typeof win.KeyboardEvent !== "function") {
      return;
    }

    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    const target = doc.activeElement || doc.body || doc.documentElement;
    if (!target?.dispatchEvent) {
      return;
    }
    const synthetic = withKeyCode(
      new win.KeyboardEvent(event.type, {
        key: spec.key,
        code: spec.code,
        bubbles: true,
        cancelable: true,
        repeat: Boolean(event.repeat)
      }),
      spec.keyCode
    );
    synthetic[SHIM_FLAG] = true;
    target.dispatchEvent(synthetic);
  };

  win.addEventListener("keydown", translate, true);
  win.addEventListener("keyup", translate, true);
  return true;
}
