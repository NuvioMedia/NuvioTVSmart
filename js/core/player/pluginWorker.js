/* global importScripts, __NUVIO_CRYPTO_JS_SOURCE__ */

import * as CheerioModule from "cheerio";

var workerScope =
  typeof self !== "undefined" ? self : typeof globalThis !== "undefined" ? globalThis : this;
var cheerio = CheerioModule;
var activeExecution = null;

function send(message) {
  workerScope.postMessage(message);
}

function asString(context, handle) {
  try {
    return context.getString(handle);
  } catch (_) {
    try {
      return String(context.dump(handle) ?? "");
    } catch (_) {
      return "";
    }
  }
}

function cheerioBridge(execution, maxDocuments = 4, maxElements = 10000) {
  var documents = new Map();
  var elements = new Map();
  var documentCounter = 0;
  var elementCounter = 0;
  var load = cheerio.load || cheerio.default?.load;
  if (typeof load !== "function") throw new Error("Cheerio load is unavailable");

  function createDocument(html) {
    if (documents.size >= maxDocuments) throw new Error("Plugin DOM document quota exceeded");
    var id = "d" + ++documentCounter;
    documents.set(id, load(String(html || ""), { decodeEntities: false }));
    return id;
  }
  function createElement(documentId, node) {
    if (!node) return "";
    if (elements.size >= maxElements) throw new Error("Plugin DOM element quota exceeded");
    var id = "e" + ++elementCounter;
    elements.set(id, { documentId, node });
    return id;
  }
  function getElement(id) {
    return elements.get(String(id || ""));
  }
  function idsFor(documentId, selection) {
    return (selection || []).map((node) => createElement(documentId, node)).filter(Boolean);
  }
  function selection(documentId, ids) {
    return (ids || [])
      .map((id) => getElement(id))
      .filter((entry) => entry && entry.documentId === documentId)
      .map((entry) => entry.node);
  }
  function textFor(documentId, ids) {
    var root = documents.get(documentId);
    if (!root) return "";
    // Jsoup's Element.text()/Elements.text() collapses runs of whitespace and
    // trims the resulting text. Cheerio leaves those runs intact, which is a
    // visible difference for title selectors used by Android providers.
    var normalizeJsoupText = (value) =>
      String(value ?? "")
        .replace(/\s+/g, " ")
        .trim();
    return selection(documentId, ids)
      .map((node) => normalizeJsoupText(root(node).text()))
      .join(" ");
  }
  function nodeHtml(documentId, id) {
    var root = documents.get(documentId);
    if (!root) return "";
    var entry = getElement(id);
    if (id) return entry ? root(entry.node).html() || "" : "";
    return root.html() || "";
  }
  function invoke(name, args) {
    switch (name) {
      case "load":
        return createDocument(args[0]);
      case "select": {
        try {
          var root = documents.get(args[0]);
          if (!root) return "[]";
          return JSON.stringify(idsFor(args[0], root(args[1] || "").toArray()));
        } catch (_) {
          // Jsoup's Android bridge converts an invalid selector into an empty
          // selection. Keep the Cheerio compatibility bridge non-throwing too.
          return "[]";
        }
      }
      case "find": {
        try {
          var findRoot = documents.get(args[0]);
          var findEntry = getElement(args[1]);
          if (!findRoot) return "[]";
          return JSON.stringify(
            idsFor(
              args[0],
              findEntry
                ? findRoot(findEntry.node)
                    .find(args[2] || "")
                    .toArray()
                : []
            )
          );
        } catch (_) {
          return "[]";
        }
      }
      case "text":
        return textFor(
          args[0],
          String(args[1] || "")
            .split(",")
            .filter(Boolean)
        );
      case "html":
        return nodeHtml(args[0], args[1]);
      case "innerHtml": {
        var innerRoot = documents.get(args[0]);
        var inner = getElement(args[1]);
        return innerRoot && inner ? innerRoot(inner.node).html() || "" : "";
      }
      case "attr": {
        var attrRoot = documents.get(args[0]);
        var attr = getElement(args[1]);
        if (!attrRoot || !attr) return "__UNDEFINED__";
        var attrValue = attrRoot(attr.node).attr(args[2]);
        return attrValue == null || attrValue === "" ? "__UNDEFINED__" : String(attrValue);
      }
      case "next": {
        var nextEntry = getElement(args[1]);
        var nextRoot = documents.get(args[0]);
        if (!nextRoot || !nextEntry) return "__NONE__";
        var nextNode = nextRoot(nextEntry.node).next().get(0);
        return nextNode ? createElement(args[0], nextNode) || "__NONE__" : "__NONE__";
      }
      case "prev": {
        var prevEntry = getElement(args[1]);
        var prevRoot = documents.get(args[0]);
        if (!prevRoot || !prevEntry) return "__NONE__";
        var prevNode = prevRoot(prevEntry.node).prev().get(0);
        return prevNode ? createElement(args[0], prevNode) || "__NONE__" : "__NONE__";
      }
      case "parent": {
        var parentEntry = getElement(args[1]);
        var parentRoot = documents.get(args[0]);
        if (!parentRoot || !parentEntry) return "__NONE__";
        var parentNode = parentRoot(parentEntry.node).parent().get(0);
        return parentNode ? createElement(args[0], parentNode) || "__NONE__" : "__NONE__";
      }
      case "children": {
        try {
          var childrenRoot = documents.get(args[0]);
          var childrenEntry = getElement(args[1]);
          if (!childrenRoot || !childrenEntry) return "[]";
          return JSON.stringify(
            idsFor(args[0], childrenRoot(childrenEntry.node).children().toArray())
          );
        } catch (_) {
          return "[]";
        }
      }
      case "filter":
        try {
          return JSON.stringify(
            idsFor(
              args[0],
              documents
                .get(args[0])(
                  selection(
                    args[0],
                    String(args[1] || "")
                      .split(",")
                      .filter(Boolean)
                  )
                )
                .filter(args[2] || "")
                .toArray()
            )
          );
        } catch (_) {
          return "[]";
        }
      case "eq": {
        var eqIds = String(args[1] || "")
          .split(",")
          .filter(Boolean);
        var eqIndex = Number(args[2]);
        return eqIndex >= 0 && eqIndex < eqIds.length ? eqIds[eqIndex] : "";
      }
      default:
        return "";
    }
  }
  return function install(context) {
    var names = [
      "load",
      "select",
      "find",
      "text",
      "html",
      "innerHtml",
      "attr",
      "next",
      "prev",
      "parent",
      "children",
      "filter",
      "eq"
    ];
    names.forEach((name) => {
      var handle = context.newFunction("__cheerio_" + name, (...args) =>
        context.newString(
          String(
            invoke(
              name,
              args.map((arg) => asString(context, arg))
            ) ?? ""
          )
        )
      );
      handle.consume((value) => context.setProp(context.global, "__cheerio_" + name, value));
    });
    execution.disposeCheerio = function () {
      documents.clear();
      elements.clear();
    };
  };
}

function pluginPolyfill() {
  return `
    (function() {
    // Capture the host bridge in this trusted closure. The names installed by
    // the host are removed immediately after this polyfill is evaluated, so a
    // plugin can use the small public compatibility surface but cannot call
    // private bridge functions directly.
    var __nuvioNativeFetch = __native_fetch;
    var __nuvioNativeCancel = __native_cancel;
    var __nuvioNativeLog = __native_log;
    var __nuvioFetchCounter = 0;
    var __nuvioParseUrl = __parse_url;
    var __nuvioCheerioLoad = __cheerio_load;
    var __nuvioCheerioSelect = __cheerio_select;
    var __nuvioCheerioFind = __cheerio_find;
    var __nuvioCheerioText = __cheerio_text;
    var __nuvioCheerioHtml = __cheerio_html;
    var __nuvioCheerioInnerHtml = __cheerio_innerHtml;
    var __nuvioCheerioAttr = __cheerio_attr;
    var __nuvioCheerioNext = __cheerio_next;
    var __nuvioCheerioPrev = __cheerio_prev;
    var __nuvioCheerioParent = __cheerio_parent;
    var __nuvioCheerioChildren = __cheerio_children;
    var __nuvioCheerioFilter = __cheerio_filter;
    var __nuvioCheerioEq = __cheerio_eq;

    globalThis.global = globalThis;
    globalThis.window = globalThis;
    globalThis.self = globalThis;
    function __nuvioFormatLogValue(value) {
      try {
        if (value && value.stack) return String(value.stack);
      } catch (_) {}
      if (value === undefined) return 'undefined';
      if (value === null) return 'null';
      if (typeof value === 'string') return value;
      try {
        var json = JSON.stringify(value);
        return json === undefined ? String(value) : json;
      } catch (_) {
        return String(value);
      }
    }
    function __nuvioForwardPluginLog(level, args) {
      var values = [];
      for (var i = 0; i < args.length; i++) values.push(__nuvioFormatLogValue(args[i]));
      try { __nuvioNativeLog(level, values.join(' ')); } catch (_) {}
    }
    // Keep provider info/debug logs quiet, but forward warnings and errors to
    // the host. The host writes them through console.warn/error so they are
    // visible in Inspector and in Settings > Console debug.
    globalThis.console = {
      log: function() {},
      info: function() {},
      warn: function() { __nuvioForwardPluginLog('warn', arguments); },
      error: function() { __nuvioForwardPluginLog('error', arguments); },
      debug: function() {}
    };
    globalThis.SCRAPER_ID = __get_scraper_id();
    globalThis.SCRAPER_SETTINGS = JSON.parse(__get_scraper_settings());
    globalThis.TMDB_API_KEY = __get_tmdb_api_key();

    function __nuvioEncodeBytes(bytes) {
      var chunks = [];
      for (var i = 0; i < bytes.length; i += 8192) {
        chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)));
      }
      return btoa(chunks.join(''));
    }
    function __nuvioDecodeBytes(base64) {
      var binary = atob(base64);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes.buffer;
    }
    var fetch = function(url, options) {
      options = options || {};
      var method = String(options.method || 'GET').toUpperCase();
      var headers = options.headers || {};
      var body = options.body || '';
      var binaryBody = body instanceof ArrayBuffer ? new Uint8Array(body) :
        ArrayBuffer.isView(body) ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength) : null;
      var signal = options.signal;
      if (signal && signal.aborted) { var before = new Error('The operation was aborted.'); before.name = 'AbortError'; return Promise.reject(before); }
      if (!headers['User-Agent']) headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
      var abortToken = signal ? 'fetch-' + (++__nuvioFetchCounter) : '';
      var abortListener = abortToken ? function() { try { __nuvioNativeCancel(abortToken); } catch (_) {} } : null;
      var cleanup = function() { if (signal && abortListener) signal.removeEventListener('abort', abortListener); };
      if (signal && abortListener) signal.addEventListener('abort', abortListener);
      var request = { url: String(url && url.href || url || ''), method: method, headers: headers, body: binaryBody ? '' : String(body), responseEncoding: 'base64' };
      if (binaryBody) request.bodyBase64 = __nuvioEncodeBytes(binaryBody);
      return __nuvioNativeFetch(JSON.stringify(request), abortToken).then(function(raw) {
        cleanup();
        var payload = JSON.parse(raw);
        if (signal && signal.aborted) { var after = new Error('The operation was aborted.'); after.name = 'AbortError'; return Promise.reject(after); }
        return {
          ok: payload.ok,
          status: payload.status,
          statusText: payload.statusText,
          url: payload.url,
          headers: {
            get: function(name) {
              return payload.headers && payload.headers[String(name || '').toLowerCase()] || null;
            }
          },
          text: function() { return Promise.resolve(payload.body); },
          arrayBuffer: function() {
            var encoded = typeof payload.bodyBase64 === 'string' ? payload.bodyBase64 :
              btoa(unescape(encodeURIComponent(payload.body || '')));
            return Promise.resolve(__nuvioDecodeBytes(encoded));
          },
          json: function() {
            try {
              if (payload.body === null || payload.body === undefined || payload.body === '') return Promise.resolve(null);
              return Promise.resolve(JSON.parse(payload.body));
            } catch (_) {
              console.error('fetch.json parse error:', _ && _.message ? _.message : _);
              return Promise.resolve(null);
            }
          }
        };
      }, function(error) {
        cleanup();
        throw error;
      });
    };
    globalThis.fetch = fetch;
    if (typeof AbortSignal === 'undefined') {
      globalThis.AbortSignal = function() { this.aborted = false; this.reason = undefined; this._listeners = []; };
      AbortSignal.prototype.addEventListener = function(type, fn) { if (type === 'abort' && typeof fn === 'function') this._listeners.push(fn); };
      AbortSignal.prototype.removeEventListener = function(type, fn) { if (type === 'abort') this._listeners = this._listeners.filter(function(entry) { return entry !== fn; }); };
      AbortSignal.prototype.dispatchEvent = function(event) { if (!event || event.type !== 'abort') return true; this._listeners.slice().forEach(function(fn) { try { fn.call(this, event); } catch (_) {} }, this); return true; };
    }
    if (typeof AbortController === 'undefined') {
      globalThis.AbortController = function() { this.signal = new AbortSignal(); };
      AbortController.prototype.abort = function(reason) { if (this.signal.aborted) return; this.signal.aborted = true; this.signal.reason = reason; this.signal.dispatchEvent({ type: 'abort' }); };
    }
    if (typeof atob === 'undefined') globalThis.atob = function(input) { var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='; var str = String(input).replace(/=+$/, ''); if (str.length % 4 === 1) throw new Error('InvalidCharacterError'); var output = ''; var bc = 0; var bs; var buffer; var idx = 0; while ((buffer = str.charAt(idx++))) { buffer = chars.indexOf(buffer); if (buffer === -1) continue; bs = bc % 4 ? bs * 64 + buffer : buffer; if (bc++ % 4) output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6))); } return output; };
    if (typeof btoa === 'undefined') globalThis.btoa = function(input) { var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='; var str = String(input); var output = ''; for (var block, charCode, idx = 0, map = chars; str.charAt(idx | 0) || (map = '=', idx % 1); output += map.charAt(63 & (block >> (8 - (idx % 1) * 8)))) { charCode = str.charCodeAt(idx += 3 / 4); if (charCode > 0xFF) throw new Error('InvalidCharacterError'); block = (block << 8) | charCode; } return output; };
    var URL = function(url, base) {
      var urlString = String(url && url.href || url || '');
      var fullUrl = urlString;
      if (base && !new RegExp('^https?://', 'i').test(urlString)) {
        var baseString = typeof base === 'string' ? base : base.href;
        if (urlString.charAt(0) === '/') {
          var originMatch = baseString.match(new RegExp('^(https?://[^/]+)'));
          fullUrl = originMatch ? originMatch[1] + urlString : urlString;
        } else {
          fullUrl = baseString.replace(new RegExp('/[^/]*$'), '/') + urlString;
        }
      }
      var parsed = JSON.parse(__nuvioParseUrl(fullUrl));
      this.href = fullUrl; this.protocol = parsed.protocol; this.host = parsed.host; this.hostname = parsed.hostname; this.port = parsed.port; this.pathname = parsed.pathname; this.search = parsed.search; this.hash = parsed.hash;
      this.origin = parsed.protocol + '//' + parsed.host;
      this.searchParams = new URLSearchParams(parsed.search);
    };
    globalThis.URL = URL;
    URL.prototype.toString = function() { return this.href; };
    var URLSearchParams = function(init) {
      this._params = {};
      var self = this;
      if (init && typeof init === 'object' && !Array.isArray(init)) {
        Object.keys(init).forEach(function(key) { self._params[key] = String(init[key]); });
      } else if (typeof init === 'string') {
        init.replace(/^\\?/, '').split('&').forEach(function(pair) {
          var parts = pair.split('=');
          if (parts[0]) self._params[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1] || '');
        });
      }
    };
    globalThis.URLSearchParams = URLSearchParams;
    URLSearchParams.prototype.toString = function() { var self = this; return Object.keys(this._params).map(function(key) { return encodeURIComponent(key) + '=' + encodeURIComponent(self._params[key]); }).join('&'); };
    URLSearchParams.prototype.get = function(key) { return this._params.hasOwnProperty(key) ? this._params[key] : null; };
    URLSearchParams.prototype.set = function(key, value) { this._params[key] = String(value); };
    URLSearchParams.prototype.append = function(key, value) { this._params[key] = String(value); };
    URLSearchParams.prototype.has = function(key) { return this._params.hasOwnProperty(key); };
    URLSearchParams.prototype.delete = function(key) { delete this._params[key]; };
    URLSearchParams.prototype.keys = function() { return Object.keys(this._params); };
    URLSearchParams.prototype.values = function() { var self = this; return Object.keys(this._params).map(function(key) { return self._params[key]; }); };
    URLSearchParams.prototype.entries = function() { var self = this; return Object.keys(this._params).map(function(key) { return [key, self._params[key]]; }); };
    URLSearchParams.prototype.forEach = function(callback) { var self = this; Object.keys(this._params).forEach(function(key) { callback(self._params[key], key, self); }); };
    URLSearchParams.prototype.getAll = function(key) { return this._params.hasOwnProperty(key) ? [this._params[key]] : []; };
    URLSearchParams.prototype.sort = function() { var sorted = {}; var self = this; Object.keys(this._params).sort().forEach(function(key) { sorted[key] = self._params[key]; }); this._params = sorted; };

    function __nuvioWrap(docId, ids) {
      ids = ids || [];
      var wrapper = { _docId: docId, _elementIds: ids, length: ids.length };
      wrapper.each = function(callback) { for (var i = 0; i < ids.length; i++) { var item = __nuvioWrap(docId, [ids[i]]); callback.call(item, i, item); } return wrapper; };
      wrapper.find = function(selector) { var allIds = []; for (var i = 0; i < ids.length; i++) { var found = JSON.parse(__nuvioCheerioFind(docId, ids[i], selector)); allIds = allIds.concat(found); } return __nuvioWrap(docId, allIds); };
      wrapper.text = function() { if (ids.length === 0) return ''; return __nuvioCheerioText(docId, ids.join(',')); };
      wrapper.html = function() { if (ids.length === 0) return ''; return __nuvioCheerioInnerHtml(docId, ids[0]); };
      wrapper.attr = function(name) { if (ids.length === 0) return undefined; var value = __nuvioCheerioAttr(docId, ids[0], name); return value === '__UNDEFINED__' ? undefined : value; };
      wrapper.first = function() { return __nuvioWrap(docId, ids.length > 0 ? [ids[0]] : []); };
      wrapper.last = function() { return __nuvioWrap(docId, ids.length > 0 ? [ids[ids.length - 1]] : []); };
      wrapper.next = function() { var nextIds = []; for (var i = 0; i < ids.length; i++) { var nextId = __nuvioCheerioNext(docId, ids[i]); if (nextId && nextId !== '__NONE__') nextIds.push(nextId); } return __nuvioWrap(docId, nextIds); };
      wrapper.prev = function() { var prevIds = []; for (var i = 0; i < ids.length; i++) { var prevId = __nuvioCheerioPrev(docId, ids[i]); if (prevId && prevId !== '__NONE__') prevIds.push(prevId); } return __nuvioWrap(docId, prevIds); };
      wrapper.eq = function(index) { if (index >= 0 && index < ids.length) return __nuvioWrap(docId, [ids[index]]); return __nuvioWrap(docId, []); };
      wrapper.get = function(index) { if (typeof index === 'number') { if (index >= 0 && index < ids.length) return __nuvioWrap(docId, [ids[index]]); return undefined; } return ids.map(function(id) { return __nuvioWrap(docId, [id]); }); };
      wrapper.map = function(callback) { var values = []; for (var i = 0; i < ids.length; i++) { var item = __nuvioWrap(docId, [ids[i]]); var value = callback.call(item, i, item); if (value !== undefined && value !== null) values.push(value); } return { length: values.length, get: function(index) { return typeof index === 'number' ? values[index] : values; }, toArray: function() { return values; } }; };
      wrapper.filter = function(selectorOrCallback) { if (typeof selectorOrCallback !== 'function') return wrapper; var filtered = []; for (var i = 0; i < ids.length; i++) { var item = __nuvioWrap(docId, [ids[i]]); if (selectorOrCallback.call(item, i, item)) filtered.push(ids[i]); } return __nuvioWrap(docId, filtered); };
      wrapper.children = function(selector) { return wrapper.find(selector || '*'); };
      wrapper.parent = function() { return __nuvioWrap(docId, []); };
      wrapper.toArray = function() { return ids.map(function(id) { return __nuvioWrap(docId, [id]); }); };
      return wrapper;
    }
    function __nuvioLoad(html) {
      var docId = __nuvioCheerioLoad(String(html || ''));
      var $ = function(selector, context) {
        if (selector && selector._elementIds) return selector;
        if (context && context._elementIds && context._elementIds.length > 0) {
          var contextIds = [];
          for (var i = 0; i < context._elementIds.length; i++) {
            JSON.parse(__nuvioCheerioFind(docId, context._elementIds[i], selector)).forEach(function(id) { contextIds.push(id); });
          }
          return __nuvioWrap(docId, contextIds);
        }
        return __nuvioWrap(docId, JSON.parse(__nuvioCheerioSelect(docId, String(selector || ''))));
      };
      $.html = function(element) { return element && element._elementIds && element._elementIds.length > 0 ? __nuvioCheerioHtml(docId, element._elementIds[0]) : __nuvioCheerioHtml(docId, ''); };
      return $;
    }
    var cheerio = { load: __nuvioLoad };
    var require = function(name) { if (name === 'cheerio' || name === 'cheerio-without-node-native' || name === 'react-native-cheerio') return cheerio; if (name === 'crypto-js') return globalThis.CryptoJS; throw new Error('Module not allowed: ' + name); };
    // Android exposes these as top-level compatibility bindings. Publish only
    // the lowercase module/function names that providers can use there; do not
    // add browser-only constructor globals such as Headers, Response or
    // Cheerio.
    globalThis.cheerio = cheerio;
    globalThis.require = require;
    if (!Array.prototype.flat) {
      Array.prototype.flat = function(depth) {
        depth = depth === undefined ? 1 : Math.floor(depth);
        if (depth < 1) return Array.prototype.slice.call(this);
        return (function flatten(arr, currentDepth) {
          return currentDepth > 0 ? arr.reduce(function(acc, value) {
            return acc.concat(Array.isArray(value) ? flatten(value, currentDepth - 1) : value);
          }, []) : arr.slice();
        })(this, depth);
      };
    }
    if (!Array.prototype.flatMap) {
      Array.prototype.flatMap = function(callback, thisArg) {
        return this.map(callback, thisArg).flat();
      };
    }
    if (!Object.entries) {
      Object.entries = function(object) {
        var result = [];
        for (var key in object) if (Object.prototype.hasOwnProperty.call(object, key)) result.push([key, object[key]]);
        return result;
      };
    }
    if (!Object.fromEntries) {
      Object.fromEntries = function(entries) {
        var result = {};
        for (var i = 0; i < entries.length; i++) result[entries[i][0]] = entries[i][1];
        return result;
      };
    }
    if (!String.prototype.replaceAll) {
      String.prototype.replaceAll = function(search, replacement) {
        if (search instanceof RegExp) {
          if (!search.global) throw new TypeError('replaceAll must be called with a global RegExp');
          return this.replace(search, replacement);
        }
        return this.split(search).join(replacement);
      };
    }
    // Keep the standard JavaScript dynamic-code APIs available inside this
    // isolated QuickJS context. Android providers use eval/Function for
    // deobfuscation; isolation is provided by the dedicated context and the
    // bridge cleanup above, not by rejecting valid JavaScript syntax.
    })();
  `;
}

async function resolveGuestPromise(context, runtime, handle, timeoutMs) {
  let settled = false;
  let resolution = null;
  context.resolvePromise(handle).then(
    (result) => {
      settled = true;
      resolution = result;
    },
    (error) => {
      settled = true;
      resolution = error;
    }
  );
  const startedAt = Date.now();
  while (!settled && Date.now() - startedAt < Number(timeoutMs || 60000)) {
    const jobs = runtime.executePendingJobs();
    if (jobs?.error) {
      const errorHandle = context.unwrapResult(jobs);
      const message = String(context.dump(errorHandle)?.message || "QuickJS pending job failed");
      errorHandle.dispose();
      throw new Error(message);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (!settled) {
    throw new Error("Plugin promise timed out");
  }
  return resolution;
}

async function execute(message) {
  importScripts("../libs/quickjs-emscripten.global.js");
  var QJS = workerScope.QJS;
  if (!QJS || typeof QJS.getQuickJS !== "function")
    throw new Error("QuickJS WASM asset unavailable");
  var request = message || {};
  var quota = request.quota || {};
  var execution = {
    pending: new Map(),
    abortTokens: new Map(),
    requestCounter: 0,
    disposeCheerio: null,
    context: null,
    settleFetch: null,
    rejectPending: null
  };
  activeExecution = execution;
  // The network bridge returns a QuickJS promise immediately and resolves it
  // from the Worker message loop. It never suspends a synchronous QuickJS C
  // callback on a native JS promise, so Asyncify is unnecessary here. Keep
  // the VM on the regular QuickJS module, as Android does, and drive promise
  // jobs explicitly in resolveGuestPromise(). This avoids Asyncify re-entry
  // and its smaller/less predictable host stack on Tizen Web Workers.
  var quickJS = await QJS.getQuickJS();
  var context = quickJS.newContext({
    // Eval is required by quickjs-emscripten's evalCode host API and remains
    // available to the guest, as it does on Android.
    intrinsics: {
      BaseObjects: true,
      Date: true,
      Eval: true,
      StringNormalize: true,
      RegExp: true,
      JSON: true,
      Proxy: true,
      MapSet: true,
      TypedArrays: true,
      Promise: true,
      BigInt: true
    }
  });
  var runtime = context.runtime;
  execution.context = context;
  runtime.setMemoryLimit?.(Number(quota.memoryLimitBytes || 32 * 1024 * 1024));
  // Keep QuickJS's compiled default stack policy, as Android does. The old
  // 512 KiB override was a stricter Tizen-only limit and caused compatible
  // Nuvio JS providers to fail with "Maximum call stack size exceeded".
  var deadline = Number(request.deadline) || Date.now() + Number(request.timeoutMs || 60000);
  runtime.setInterruptHandler?.(() => Date.now() > deadline);

  function installSync(name, fn) {
    var handle = context.newFunction(name, (...args) =>
      context.newString(String(fn(...args.map((arg) => asString(context, arg))) ?? ""))
    );
    handle.consume((value) => context.setProp(context.global, name, value));
  }
  installSync("__get_scraper_id", () => String(request.scraperId || ""));
  installSync("__get_scraper_settings", () => JSON.stringify(request.settings || {}));
  installSync("__get_tmdb_api_key", () => String(request.tmdbApiKey || ""));
  installSync("__native_log", (level, message) => {
    send({
      type: "pluginLog",
      level: String(level || "").toLowerCase() === "error" ? "error" : "warn",
      message: String(message || "").slice(0, 4000)
    });
    return "";
  });
  installSync("__native_cancel", (abortToken) => {
    var requestId = execution.abortTokens.get(String(abortToken || ""));
    if (!requestId) return false;
    send({ type: "cancel", requestId });
    return true;
  });
  installSync("__parse_url", (value, base) => {
    try {
      var parsed = new URL(String(value || ""), String(base || "") || undefined);
      return JSON.stringify({
        href: parsed.href,
        protocol: parsed.protocol,
        host: parsed.host,
        hostname: parsed.hostname,
        port: parsed.port,
        pathname: parsed.pathname,
        search: parsed.search,
        hash: parsed.hash
      });
    } catch (_) {
      return JSON.stringify({
        href: String(value || ""),
        protocol: "",
        host: "",
        hostname: "",
        port: "",
        pathname: "/",
        search: "",
        hash: ""
      });
    }
  });
  cheerioBridge(
    execution,
    Math.max(1, Number(quota.maxDocuments || 4)),
    Math.max(100, Number(quota.maxDomElements || 10000))
  )(context);

  function settleFetch(requestId, payload, error) {
    var pending = execution.pending.get(requestId);
    if (!pending) return;
    execution.pending.delete(requestId);
    if (pending.abortToken) execution.abortTokens.delete(pending.abortToken);
    try {
      if (error) {
        var errorHandle = context.newError(error);
        try {
          pending.deferred.reject(errorHandle);
        } finally {
          errorHandle.dispose();
        }
      } else {
        var payloadHandle = context.newString(JSON.stringify(payload || {}));
        try {
          pending.deferred.resolve(payloadHandle);
        } finally {
          payloadHandle.dispose();
        }
      }
    } finally {
      pending.deferred.dispose();
    }
  }
  execution.settleFetch = settleFetch;
  execution.rejectPending = function (error) {
    Array.from(execution.pending.keys()).forEach((requestId) =>
      settleFetch(requestId, null, error)
    );
  };

  execution.cleanup = function () {
    if (execution.cleaned) return;
    execution.cleaned = true;
    execution.rejectPending?.(new Error("Plugin execution ended"));
    // Rejecting a QuickJS promise queues guest reactions. Drain those jobs
    // while the context is still alive so their handles are released before
    // the runtime is disposed. A broken provider must not be able to enqueue
    // new bridge work while this bounded cleanup drain is running.
    for (let attempts = 0; attempts < 64; attempts += 1) {
      let jobs;
      try {
        jobs = runtime.executePendingJobs();
      } catch (_) {
        break;
      }
      if (jobs?.error) {
        try {
          context.unwrapResult(jobs).dispose();
        } catch (_) {}
        break;
      }
      if (!Number(jobs?.value || 0)) {
        break;
      }
    }
    execution.pending.clear();
    // executePendingJobs() can materialize a wrapper for a QuickJS context
    // whose pointer is not present in the original context map. Dispose such
    // auxiliary contexts before the primary context, which owns the runtime.
    var contexts = Array.from(runtime.contextMap?.values?.() || []);
    contexts.forEach((candidate) => {
      if (!candidate || candidate === execution.context || !candidate.alive) return;
      try {
        candidate.dispose();
      } catch (_) {}
    });
    try {
      execution.context?.dispose?.();
    } catch (_) {}
    try {
      execution.disposeCheerio?.();
    } catch (_) {}
    execution.context = null;
    execution.disposeCheerio = null;
  };

  var nativeFetch = context.newFunction("__native_fetch", (...args) => {
    if (execution.cleaned) {
      throw new Error("Plugin execution ended");
    }
    var payload = JSON.parse(asString(context, args[0]) || "{}");
    var requestId = String(request.executionId || "execution") + "-" + ++execution.requestCounter;
    var abortToken = asString(context, args[1]);
    payload.requestId = requestId;
    var deferred = context.newPromise();
    execution.pending.set(requestId, { deferred, abortToken });
    if (abortToken) execution.abortTokens.set(abortToken, requestId);
    try {
      send({ type: "fetch", requestId, payload });
    } catch (error) {
      settleFetch(requestId, null, error);
    }
    return deferred.handle;
  });
  nativeFetch.consume((value) => context.setProp(context.global, "__native_fetch", value));
  var polyfill = pluginPolyfill();
  var polyfillResult = context.evalCode(polyfill, "nuvio-plugin-polyfill.js");
  context.unwrapResult(polyfillResult).dispose();
  var cryptoJsSource =
    typeof __NUVIO_CRYPTO_JS_SOURCE__ === "string" ? __NUVIO_CRYPTO_JS_SOURCE__ : "";
  if (!cryptoJsSource) throw new Error("CryptoJS source asset unavailable");
  // Android evaluates the published CryptoJS UMD source directly after the
  // standard polyfill. Keep the same bootstrap: with no CommonJS module
  // globals present, the source installs itself on the global object and the
  // Android-compatible require shim returns that exact object.
  var cryptoJsResult = context.evalCode(
    cryptoJsSource +
      "\nif (!globalThis.CryptoJS) throw new Error('CryptoJS global unavailable'); true;",
    "crypto-js.js"
  );
  context.unwrapResult(cryptoJsResult).dispose();
  var bridgeCleanup = context.evalCode(
    '["__native_fetch","__native_cancel","__native_log","__parse_url","__get_scraper_id","__get_scraper_settings","__get_tmdb_api_key","__cheerio_load","__cheerio_select","__cheerio_find","__cheerio_text","__cheerio_html","__cheerio_innerHtml","__cheerio_attr","__cheerio_next","__cheerio_prev","__cheerio_parent","__cheerio_children","__cheerio_filter","__cheerio_eq"].forEach(function(name){ try { globalThis[name] = undefined; delete globalThis[name]; } catch (_) {} }); true;',
    "nuvio-plugin-bridge-cleanup.js"
  );
  context.unwrapResult(bridgeCleanup).dispose();
  var source = String(request.code || "");
  var sourceBytes =
    typeof TextEncoder === "function"
      ? new TextEncoder().encode(source).byteLength
      : unescape(encodeURIComponent(source)).length;
  if (sourceBytes > Number(quota.maxCodeBytes || 1024 * 1024))
    throw new Error("Plugin code exceeds quota");
  var moduleResult = context.evalCode(
    "var module = { exports: {} }; var exports = module.exports; (function(){\n" +
      source +
      "\n})(); globalThis.__pluginModuleExports = module.exports;",
    String(request.filename || "plugin.js")
  );
  context.unwrapResult(moduleResult).dispose();
  var callHandle;
  function disposeCallHandle() {
    if (!callHandle) return;
    try {
      callHandle.dispose();
    } catch (_) {}
    callHandle = null;
  }
  try {
    var callResult = context.evalCode(
      "(async function(){ try { var exported = globalThis.__pluginModuleExports || {}; var fn = exported.getStreams || globalThis.getStreams; if (typeof fn !== 'function') return JSON.stringify([]); var args = " +
        JSON.stringify(request.args || {}) +
        "; var value = await fn(args.tmdbId, args.mediaType, args.season, args.episode); return JSON.stringify(Array.isArray(value) ? value : []); } catch (_) { try { console.error('getStreams failed:', _); } catch (__) {} return JSON.stringify([]); } })()",
      "nuvio-plugin-call.js"
    );
    callHandle = context.unwrapResult(callResult);
  } catch (error) {
    // A synchronous provider failure can be reported by QuickJS while
    // evaluating the async call expression itself (before a Promise handle is
    // returned). It is still an exception of getStreams and follows Android's
    // empty-result contract.
    execution.cleanup();
    activeExecution = null;
    send({
      type: "pluginLog",
      level: "error",
      message: "getStreams invocation failed: " + String(error?.message || error)
    });
    send({ type: "result", results: [] });
    return;
  }
  var resolvedCallResult;
  var providerCallError = null;
  try {
    resolvedCallResult = await resolveGuestPromise(context, runtime, callHandle, request.timeoutMs);
  } catch (error) {
    providerCallError = error;
  }
  if (providerCallError) {
    // Dispose the promise returned by the provider before cleanup disposes the
    // QuickJS context. The previous order left this live handle attached to a
    // disposed runtime and reproduced JS_FreeRuntime's gc_obj_list assertion.
    disposeCallHandle();
    // Android's PluginRuntime catches every exception raised by getStreams,
    // including QuickJS pending-job failures such as a provider stack
    // overflow, and reports an empty result to the manager. Keep bootstrap and
    // module-evaluation failures above as real worker errors; this boundary
    // covers only the provider call itself.
    execution.cleanup();
    activeExecution = null;
    send({
      type: "pluginLog",
      level: "error",
      message:
        "getStreams promise failed: " + String(providerCallError?.message || providerCallError)
    });
    send({ type: "result", results: [] });
    return;
  }
  disposeCallHandle();
  var resolvedCallHandle = context.unwrapResult(resolvedCallResult);
  var resultJson = context.dump(resolvedCallHandle);
  resolvedCallHandle.dispose();
  var results;
  try {
    results = JSON.parse(typeof resultJson === "string" ? resultJson : String(resultJson || "[]"));
  } catch (error) {
    send({
      type: "pluginLog",
      level: "error",
      message: "Plugin returned invalid JSON: " + String(error?.message || error)
    });
    results = [];
  }
  results = Array.isArray(results)
    ? results.slice(0, Number(quota.maxResultsPerScraper || 25))
    : [];
  execution.cleanup();
  activeExecution = null;
  send({ type: "result", results });
}

workerScope.onmessage = function (event) {
  var message = event?.data || {};
  if (message.type === "fetchResult" && activeExecution) {
    if (message.error)
      activeExecution.settleFetch?.(message.requestId, null, new Error(message.error));
    else activeExecution.settleFetch?.(message.requestId, message.payload || {}, null);
    return;
  }
  if (message.type === "execute") {
    execute(message).catch((error) => {
      if (activeExecution) {
        activeExecution.rejectPending?.(error);
        activeExecution.cleanup?.();
      }
      activeExecution = null;
      send({ type: "error", error: String(error?.message || error) });
    });
  }
};
