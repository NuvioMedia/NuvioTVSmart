let decoderModulePromise = null;

function installUtf8CodecFallbacks() {
  if (typeof globalThis.TextEncoder !== "function") {
    globalThis.TextEncoder = class TextEncoderFallback {
      encode(value = "") {
        const encoded = unescape(encodeURIComponent(String(value)));
        const bytes = new Uint8Array(encoded.length);
        for (let index = 0; index < encoded.length; index += 1) {
          bytes[index] = encoded.charCodeAt(index);
        }
        return bytes;
      }

      encodeInto(value, destination) {
        const text = String(value);
        let read = 0;
        let written = 0;
        while (read < text.length) {
          const firstUnit = text.charCodeAt(read);
          const hasSurrogatePair =
            firstUnit >= 0xd800 && firstUnit <= 0xdbff && read + 1 < text.length;
          const character = text.slice(read, read + (hasSurrogatePair ? 2 : 1));
          const bytes = this.encode(character);
          if (written + bytes.length > destination.length) {
            break;
          }
          destination.set(bytes, written);
          written += bytes.length;
          read += character.length;
        }
        return { read, written };
      }
    };
  }

  if (typeof globalThis.TextDecoder !== "function") {
    globalThis.TextDecoder = class TextDecoderFallback {
      decode(value) {
        const bytes = value
          ? new Uint8Array(value.buffer || value, value.byteOffset || 0, value.byteLength)
          : new Uint8Array(0);
        let binary = "";
        const chunkSize = 8192;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
          binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + chunkSize));
        }
        try {
          return decodeURIComponent(escape(binary));
        } catch (_) {
          return binary;
        }
      }
    };
  }
}

export function supportsBitmapSubtitleDecoding() {
  if (
    typeof globalThis.WebAssembly !== "object" ||
    typeof globalThis.Uint8Array !== "function" ||
    typeof globalThis.Uint8ClampedArray !== "function" ||
    typeof globalThis.Promise !== "function" ||
    typeof globalThis.fetch !== "function" ||
    typeof globalThis.document?.createElement !== "function"
  ) {
    return false;
  }
  try {
    return Boolean(globalThis.document.createElement("canvas").getContext("2d"));
  } catch (_) {
    return false;
  }
}

async function loadDecoderModule() {
  if (!supportsBitmapSubtitleDecoding()) {
    throw new Error("Bitmap subtitles are not supported by this TV browser");
  }
  if (!decoderModulePromise) {
    decoderModulePromise = (async () => {
      installUtf8CodecFallbacks();
      const [module, wasmResponse] = await Promise.all([
        import("libbitsub/pkg"),
        fetch("assets/libs/libbitsub_bg.wasm")
      ]);
      if (!wasmResponse.ok) {
        throw new Error(`Bitmap subtitle decoder failed to load (${wasmResponse.status})`);
      }
      const wasmBytes = await wasmResponse.arrayBuffer();
      await module.default({ module_or_path: wasmBytes });
      module.init();
      return module;
    })().catch((error) => {
      decoderModulePromise = null;
      throw error;
    });
  }
  return decoderModulePromise;
}

export async function warmBitmapSubtitleDecoder() {
  await loadDecoderModule();
  return true;
}

export function normalizeBitmapSubtitleFormat(value) {
  const text = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (/\bVOB[ /-]*SUB\b|\bDVD[ /-]*SUB(?:TITLE)?\b/.test(text)) {
    return "vobsub";
  }
  if (/\b(?:HDMV[ /-]*)?PGS\b|\bPRESENTATION GRAPHIC STREAM\b/.test(text)) {
    return "pgs";
  }
  return null;
}

export class BitmapSubtitleDecoder {
  constructor() {
    this.parser = null;
    this.format = null;
    this.loadToken = 0;
    this.disposed = false;
  }

  async load(options, legacyData) {
    this.dispose();
    this.disposed = false;
    const token = ++this.loadToken;
    const request =
      options && typeof options === "object" && !(options instanceof Uint8Array)
        ? options
        : { format: "vobsub", idxContent: options, data: legacyData };
    const format = normalizeBitmapSubtitleFormat(request.format);
    const data = request.data;
    if ((format !== "vobsub" && format !== "pgs") || !(data instanceof Uint8Array)) {
      throw new Error("Invalid bitmap subtitle decoder input");
    }
    const module = await loadDecoderModule();
    if (this.disposed || token !== this.loadToken) {
      return 0;
    }
    const parser = format === "pgs" ? new module.PgsParser() : new module.VobSubParser();
    try {
      if (format === "pgs") {
        parser.parse(data);
      } else {
        parser.loadFromData(String(request.idxContent || ""), data);
      }
      if (this.disposed || token !== this.loadToken) {
        parser.dispose?.();
        parser.free?.();
        return 0;
      }
      this.parser = parser;
      this.format = format;
    } catch (error) {
      parser.dispose?.();
      parser.free?.();
      throw error;
    }
    return parser.count;
  }

  renderAtSeconds(timeSeconds) {
    const parser = this.parser;
    if (!parser) {
      return null;
    }
    const timestampMs = Math.max(0, Number(timeSeconds) || 0) * 1000;
    const index = parser.findIndexAtTimestamp(timestampMs);
    if (!Number.isFinite(index) || index < 0 || index >= parser.count) {
      return null;
    }
    const startMs = parser.getCueStartTime(index);
    const endMs = parser.getCueEndTime(index);
    if (timestampMs < startMs || timestampMs >= endMs) {
      return null;
    }
    const frame = parser.renderAtIndex(index);
    if (!frame) {
      if (this.format === "pgs" && parser.getCueCompositionCount(index) === 0) {
        return {
          key: `pgs:${index}:${startMs}:${endMs}`,
          startMs,
          endMs,
          screenWidth: parser.screenWidth,
          screenHeight: parser.screenHeight,
          compositions: []
        };
      }
      return null;
    }
    try {
      if (this.format === "pgs") {
        const compositions = [];
        const compositionCount = Math.max(0, Number(frame.compositionCount) || 0);
        for (let compositionIndex = 0; compositionIndex < compositionCount; compositionIndex += 1) {
          const composition = frame.getComposition(compositionIndex);
          if (!composition) {
            continue;
          }
          try {
            compositions.push({
              x: composition.x,
              y: composition.y,
              width: composition.width,
              height: composition.height,
              rgba: new Uint8ClampedArray(composition.getRgba())
            });
          } finally {
            composition.free?.();
          }
        }
        return {
          key: `pgs:${index}:${startMs}:${endMs}`,
          startMs,
          endMs,
          screenWidth: parser.screenWidth || frame.width,
          screenHeight: parser.screenHeight || frame.height,
          compositions
        };
      }
      return {
        key: `vobsub:${index}:${startMs}:${endMs}`,
        startMs,
        endMs,
        screenWidth: frame.screenWidth,
        screenHeight: frame.screenHeight,
        compositions: [
          {
            x: frame.x,
            y: frame.y,
            width: frame.width,
            height: frame.height,
            rgba: new Uint8ClampedArray(frame.getRgba())
          }
        ]
      };
    } finally {
      frame.free?.();
    }
  }

  dispose() {
    this.loadToken += 1;
    this.disposed = true;
    if (!this.parser) {
      return;
    }
    try {
      this.parser.dispose?.();
      this.parser.free?.();
    } catch (_) {
      // Best effort cleanup for WASM-owned memory.
    }
    this.parser = null;
    this.format = null;
  }
}
