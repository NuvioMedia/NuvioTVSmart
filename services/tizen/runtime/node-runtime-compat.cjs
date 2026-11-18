/* Node APIs the vendored EngineFS runtime expects. ES5 for TV runtimes. */
// A Tizen 5.0 TV runs the EngineFS service on Node 4.4.3. These gaps broke the
// embedded-track reader behind /tracks there, so it never answered:
// - Buffer.from(string, encoding) arrived in Node 4.5. Before it, Buffer.from
//   is Uint8Array.from, so Buffer.from("1A45DFA3", "hex") is no Buffer and
//   Buffer.compare() threw inside an async handler nobody awaited.
// - Buffer#subarray() returned a Uint8Array before Node 5, so the chunks the
//   reader parses were no Buffers either.
// - readable.readableHighWaterMark arrived in Node 9.3; undefined there became
//   "Range: bytes=0-NaN".
// - readable.destroy() arrived in Node 8, and the reader stops with it.
// Only what is missing is added, with the semantics of the Node release that
// introduced it.
// Buffer inherits "from" from Uint8Array as a read-only property there, so a
// plain assignment is silently ignored; an own property is required.
function defineStatic(target, name, value) {
  Object.defineProperty(target, name, { configurable: true, enumerable: false, writable: true, value: value });
}

module.exports = function installNodeRuntimeCompat(runtime) {
  var installed = [];
  var BufferType = runtime && runtime.Buffer;
  var stream = runtime && runtime.stream;

  if (BufferType) {
    var nativeFrom = BufferType.from;
    if (typeof nativeFrom !== "function" || nativeFrom === Uint8Array.from) {
      defineStatic(BufferType, "from", function (value, encodingOrOffset, length) {
        if (typeof value === "number") {
          throw new TypeError('"value" argument must not be a number');
        }
        if (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) {
          var offset = Number(encodingOrOffset) || 0;
          var size = length === undefined ? value.byteLength - offset : Number(length);
          return new BufferType(new Uint8Array(value, offset, size));
        }
        return typeof value === "string" ? new BufferType(value, encodingOrOffset) : new BufferType(value);
      });
      installed.push("Buffer.from");
    }
    if (typeof BufferType.alloc !== "function") {
      defineStatic(BufferType, "alloc", function (size, fill, encoding) {
        var buffer = new BufferType(size);
        if (fill === undefined) {
          buffer.fill(0);
        } else if (typeof fill === "string") {
          buffer.fill(fill, 0, buffer.length, encoding);
        } else {
          buffer.fill(fill);
        }
        return buffer;
      });
      installed.push("Buffer.alloc");
    }
    // Node 4 inherits subarray() from Uint8Array, which returns a Uint8Array:
    // Buffer.compare() rejects it and toString("hex") ignores the encoding.
    // This is Node 5's own fix. Node 4's slice() itself calls this.subarray(),
    // so the native method must be called directly, never through slice().
    var probe = new BufferType(2);
    var nativeSubarray = Uint8Array.prototype.subarray;
    if (
      typeof BufferType.isBuffer === "function" &&
      typeof probe.subarray === "function" &&
      !BufferType.isBuffer(probe.subarray(0, 1))
    ) {
      defineStatic(BufferType.prototype, "subarray", function (start, end) {
        var view = nativeSubarray.call(this, start, end);
        Object.setPrototypeOf(view, BufferType.prototype);
        return view;
      });
      installed.push("Buffer#subarray");
    }
    if (typeof BufferType.allocUnsafe !== "function") {
      defineStatic(BufferType, "allocUnsafe", function (size) {
        return new BufferType(size);
      });
      installed.push("Buffer.allocUnsafe");
    }
  }

  // readable.destroy() arrived in Node 8; the reader calls it once the
  // decoder has what it needs, and on Node 4 that TypeError lost the result.
  var Readable = stream && stream.Readable;
  if (Readable && Readable.prototype && typeof Readable.prototype.destroy !== "function") {
    defineStatic(Readable.prototype, "destroy", function (error) {
      if (this.destroyed) {
        return this;
      }
      var self = this;
      self.destroyed = true;
      // No further _read() requests, as after Node 8's destroy().
      self._read = function () {};
      self.pause();
      process.nextTick(function () {
        if (error) {
          self.emit("error", error);
        }
        self.emit("close");
      });
      return self;
    });
    installed.push("Readable#destroy");
  }

  [
    [stream && stream.Readable, "readableHighWaterMark", "_readableState"],
    [stream && stream.Writable, "writableHighWaterMark", "_writableState"]
  ].forEach(function (pair) {
    var Type = pair[0];
    var name = pair[1];
    var stateKey = pair[2];
    if (!Type || !Type.prototype || name in Type.prototype) {
      return;
    }
    Object.defineProperty(Type.prototype, name, {
      configurable: true,
      enumerable: false,
      get: function () {
        var state = this[stateKey];
        return state ? state.highWaterMark : undefined;
      }
    });
    installed.push(name);
  });
  return installed;
};
