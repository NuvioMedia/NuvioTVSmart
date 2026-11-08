const MAX_EVENTS = 300;
const MAX_ARGUMENT_LENGTH = 6000;
const MAX_MESSAGE_LENGTH = 16000;
// Object arguments are serialised with a bounded walk instead of a full
// JSON.stringify: this wrapper is always installed, and a large payload passed
// to console.warn on a TV used to be pretty-printed in full only to be cut to
// MAX_ARGUMENT_LENGTH afterwards (issue #1208).
const MAX_OBJECT_DEPTH = 4;
const MAX_OBJECT_ENTRIES = 48;

const events = [];
const listeners = new Set();

let nextEventId = 1;
let installed = false;
let originalWarn = null;
let originalError = null;
let originalInfo = null;

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

function serializeLeaf(value) {
  if (value instanceof Error) {
    return JSON.stringify(formatError(value));
  }
  if (typeof value === "bigint") {
    return JSON.stringify(`${value.toString()}n`);
  }
  if (typeof value === "function") {
    return JSON.stringify(`[Function ${value.name || "anonymous"}]`);
  }
  if (typeof value === "symbol") {
    return JSON.stringify(String(value));
  }
  if (value === undefined) {
    return "null";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "null";
  }
  return JSON.stringify(value);
}

function serializeBounded(value, depth, stack, budget) {
  if (budget.remaining <= 0) {
    return '"…"';
  }
  if (value === null || typeof value !== "object" || value instanceof Error) {
    const leaf = serializeLeaf(value);
    budget.remaining -= leaf.length;
    return leaf;
  }
  if (typeof value.toJSON === "function") {
    try {
      return serializeBounded(value.toJSON(), depth, stack, budget);
    } catch (_) {
      // Fall through to the structural walk.
    }
  }
  if (stack.includes(value)) {
    return '"[Circular]"';
  }
  if (depth >= MAX_OBJECT_DEPTH) {
    return Array.isArray(value) ? `"[Array(${value.length})]"` : '"[Object]"';
  }
  stack.push(value);
  // Same two-space layout the debug console showed before, still valid JSON.
  const innerIndent = "  ".repeat(depth + 1);
  const closingIndent = "  ".repeat(depth);
  const parts = [];
  if (Array.isArray(value)) {
    const count = Math.min(value.length, MAX_OBJECT_ENTRIES);
    for (let index = 0; index < count && budget.remaining > 0; index += 1) {
      parts.push(innerIndent + serializeBounded(value[index], depth + 1, stack, budget));
    }
    if (value.length > count) {
      parts.push(`${innerIndent}"… ${value.length - count} more"`);
    }
    stack.pop();
    return parts.length ? `[\n${parts.join(",\n")}\n${closingIndent}]` : "[]";
  }
  const keys = Object.keys(value);
  const count = Math.min(keys.length, MAX_OBJECT_ENTRIES);
  for (let index = 0; index < count && budget.remaining > 0; index += 1) {
    const key = keys[index];
    const serialized = serializeBounded(value[key], depth + 1, stack, budget);
    budget.remaining -= key.length + 3;
    parts.push(`${innerIndent}${JSON.stringify(key)}: ${serialized}`);
  }
  if (keys.length > count) {
    parts.push(`${innerIndent}"…": "${keys.length - count} more keys"`);
  }
  stack.pop();
  return parts.length ? `{\n${parts.join(",\n")}\n${closingIndent}}` : "{}";
}

function formatObject(value) {
  try {
    return serializeBounded(value, 0, [], { remaining: MAX_ARGUMENT_LENGTH });
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
  originalInfo = typeof consoleRef.info === "function" ? consoleRef.info : function () {};

  consoleRef.warn = function (...args) {
    captureConsoleEvent("warn", args);
    return originalWarn.apply(this, args);
  };

  consoleRef.error = function (...args) {
    captureConsoleEvent("error", args);
    return originalError.apply(this, args);
  };

  consoleRef.info = function (...args) {
    // The Tizen diagnostics toggle also covers AVPlay seek and source
    // diagnostics, so capture those families. Buffering-progress lines stay
    // out: they are emitted per percent and would push the useful events out
    // of the buffer.
    const isTizenAvPlayDiagnostic =
      globalThis.__NUVIO_DEBUG_TIZEN_AVPLAY__ === true &&
      typeof args[0] === "string" &&
      (args[0].startsWith("Tizen AVPlay subtitle") ||
        args[0].startsWith("Tizen AVPlay seek") ||
        args[0].startsWith("Tizen AVPlay source"));
    if (isTizenAvPlayDiagnostic) {
      captureConsoleEvent("info", args);
    }
    return originalInfo.apply(this, args);
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
