// Draws the app icon (same design as the macOS icon, own artwork) and writes
// resources/icon.png plus build/icon.ico.  Run with Electron:  electron scripts/make-icon.js
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ball = '<circle cx="12" cy="12" r="9.2"/><path d="M12 7.3l3.6 2.6-1.4 4.2H9.8L8.4 9.9z" fill="#fff"/><path d="M12 7.3V2.9M15.6 9.9l4.1-1.4M14.2 14.1l2.6 3.6M9.8 14.1l-2.6 3.6M8.4 9.9L4.3 8.5"/>';
const svg = size => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <defs><linearGradient id="g" x1="0.1" y1="0" x2="0.75" y2="1"><stop offset="0" stop-color="#0da694"/><stop offset="1" stop-color="#055252"/></linearGradient></defs>
  <rect x="4" y="4" width="92" height="92" rx="22" fill="url(#g)"/>
  <g fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="1.2"><rect x="18" y="18" width="64" height="64" rx="3"/><path d="M18 50h64"/></g>
  <g transform="translate(26 26) scale(2)" fill="none" stroke="#fff" stroke-width="${size <= 32 ? 2.1 : 1.6}" stroke-linecap="round" stroke-linejoin="round">${ball}</g>
</svg>`;

function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e); header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt8(0, e + 2); header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(png.length, e + 8); header.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map(i => i.png)]);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  // One window, two masters (regular and bold strokes), downscaled: small sizes need bolder lines.
  const size = 1024;
  const win = new BrowserWindow({ width: size, height: size, show: false, transparent: true, frame: false, useContentSize: true,
    backgroundColor: '#00000000', webPreferences: { offscreen: true, sandbox: true } });
  await win.loadURL('about:blank');
  const master = async bold => {
    const markup = svg(bold ? 16 : size).replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`);
    await win.webContents.executeJavaScript(`document.body.style.cssText='margin:0;background:transparent;overflow:hidden';document.body.innerHTML=${JSON.stringify(markup)};true`);
    await new Promise(r => setTimeout(r, 400));
    return win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  };
  const regular = await master(false);
  const bold = await master(true);
  win.destroy();
  const png = (image, px) => image.resize({ width: px, height: px, quality: 'best' }).toPNG();
  const root = path.join(__dirname, '..');
  const images = [16, 24, 32, 48, 64, 128, 256].map(px => ({ size: px, png: png(px <= 32 ? bold : regular, px) }));
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico(images));
  fs.writeFileSync(path.join(root, 'resources', 'icon.png'), png(regular, 512));
  console.log('icon.ico and icon.png written');
  app.exit(0);
});
