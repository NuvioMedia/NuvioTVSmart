const MAX_EVENTS = 300;
const MAX_ARGUMENT_LENGTH = 6000;
const MAX_MESSAGE_LENGTH = 16000;

const events = [];
const listeners = new Set();

let nextEventId = 1;
let installed = false;
let originalWarn = null;
let originalError = null;

function truncate(value, maxLength) {
  const text = String(value ?? "");
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function formatError(value) {
  return String(value?.stack || value?.message || value);
}

function formatObject(value) {
  const seen = new Set();
  try {
    return JSON.stringify(
      value,
      (_, nestedValue) => {
        if (nestedValue instanceof Error) {
          return formatError(nestedValue);
        }
        if (typeof nestedValue === "bigint") {
          return `${nestedValue.toString()}n`;
        }
        if (typeof nestedValue === "function") {
          return `[Function ${nestedValue.name || "anonymous"}]`;
        }
        if (nestedValue && typeof nestedValue === "object") {
          if (seen.has(nestedValue)) {
            return "[Circular]";
          }
          seen.add(nestedValue);
        }
        return nestedValue;
      },
      2
    );
  } catch (_) {
    return Object.prototype.toString.call(value);
  }
}

function formatConsoleArgument(value) {
  if (value instanceof Error) {
    return truncate(formatError(value), MAX_ARGUMENT_LENGTH);
  }
  if (typeof value === "string") {
    return truncate(value, MAX_ARGUMENT_LENGTH);
  }
  if (value === undefined) {
    return "undefined";
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "bigint") {
    return `${value.toString()}n`;
  }
  if (typeof value === "symbol") {
    return String(value);
  }
  if (typeof value === "function") {
    return `[Function ${value.name || "anonymous"}]`;
  }
  return truncate(formatObject(value), MAX_ARGUMENT_LENGTH);
}

function notifyListeners() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (_) {}
  });
}

function captureConsoleEvent(level, args) {
  const timestamp = Date.now();
  const formattedArgs = Array.prototype.slice.call(args || []).map(formatConsoleArgument);
  events.push({
    id: nextEventId++,
    level,
    timestamp,
    isoTime: new Date(timestamp).toISOString(),
    args: formattedArgs,
    message: truncate(formattedArgs.join(" "), MAX_MESSAGE_LENGTH)
  });
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }
  notifyListeners();
}

export function installConsoleDebugBuffer() {
  if (installed) {
    return;
  }
  const consoleRef = globalThis.console;
  if (!consoleRef) {
    return;
  }
  installed = true;
  originalWarn = typeof consoleRef.warn === "function" ? consoleRef.warn : function () {};
  originalError = typeof consoleRef.error === "function" ? consoleRef.error : function () {};

  consoleRef.warn = function (...args) {
    captureConsoleEvent("warn", args);
    return originalWarn.apply(this, args);
  };

  consoleRef.error = function (...args) {
    captureConsoleEvent("error", args);
    return originalError.apply(this, args);
  };
}

export function getConsoleDebugEvents() {
  return events.map((event) => ({
    ...event,
    args: [...event.args]
  }));
}

export function subscribeToConsoleDebugEvents(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

installConsoleDebugBuffer();
