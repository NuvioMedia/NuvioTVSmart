// js/core/qr/qrCodeGenerator.js
/* global qrcode */

export const QrCodeGenerator = {
  generate(canvas, content, size = 512) {
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
