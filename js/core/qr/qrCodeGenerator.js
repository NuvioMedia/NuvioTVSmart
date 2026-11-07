// js/core/qr/qrCodeGenerator.js
/* global qrcode */

// The qrcode-generator library used to be a startup script on every launch.
// Only the QR sign-in, plugin and phone-config screens need it, so it is now
// loaded on first use. A package may still ship it as a startup script (webOS
// does); in that case the global already exists and nothing is fetched.
const QR_LIBRARY_SRC = "assets/libs/qrcode-generator.js";
let qrLibraryLoading = null;

function hasQrLibrary() {
  return typeof globalThis.qrcode === "function";
}

export function ensureQrCodeLibrary() {
  if (hasQrLibrary()) {
    return Promise.resolve();
  }
  if (qrLibraryLoading) {
    return qrLibraryLoading;
  }
  qrLibraryLoading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.src = QR_LIBRARY_SRC;
    script.onload = () => {
      if (hasQrLibrary()) {
        resolve();
      } else {
        reject(new Error("QR code library loaded without exposing qrcode()"));
      }
    };
    script.onerror = () => {
      script.remove();
      reject(new Error(`QR code library failed to load: ${QR_LIBRARY_SRC}`));
    };
    (document.head || document.documentElement).appendChild(script);
  }).finally(() => {
    qrLibraryLoading = null;
  });
  return qrLibraryLoading;
}

export const QrCodeGenerator = {
  generate(canvas, content, size = 512) {
    if (!hasQrLibrary()) {
      // Render as soon as the library arrives. Callers do not await this;
      // the canvas simply fills in a moment later than it would have.
      return ensureQrCodeLibrary()
        .then(() => this.generate(canvas, content, size))
        .catch((error) => {
          console.warn("QR code rendering skipped", error);
        });
    }
    const qr = qrcode(0, "M");
    qr.addData(content);
    qr.make();

    const ctx = canvas.getContext("2d");

    canvas.width = size;
    canvas.height = size;

    const cornerRadius = size * 0.06;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    this.roundRect(ctx, 0, 0, size, size, cornerRadius);
    ctx.clip();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);

    // One draw per QR module, with the existing four-module quiet zone.
    const moduleCount = qr.getModuleCount();
    const quietZoneModules = 4;
    const totalModules = moduleCount + quietZoneModules * 2;
    const moduleSize = size / totalModules;

    ctx.fillStyle = "#000000";

    for (let row = 0; row < moduleCount; row++) {
      for (let col = 0; col < moduleCount; col++) {
        if (qr.isDark(row, col)) {
          const x = (col + quietZoneModules) * moduleSize;
          const y = (row + quietZoneModules) * moduleSize;

          ctx.fillRect(x, y, moduleSize, moduleSize);
        }
      }
    }

    ctx.restore();
    return Promise.resolve();
  },

  roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }
};
