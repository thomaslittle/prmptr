const sharp = require('sharp');
const fs = require('fs');

const whiteSvg = `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <path fill="white" d="m5 13q0 0.4 0.3 0.7 0.3 0.3 0.7 0.3 0.4 0 0.7-0.3 0.3-0.3 0.3-0.7c0-2.4 0.9-4.7 2.6-6.4 1.7-1.7 4-2.6 6.4-2.6 2.4 0 4.7 0.9 6.4 2.6 1.7 1.7 2.6 4 2.6 6.4 0 3.3-1.1 4.4-2.2 5.5-1.1 1-2.3 2.2-2.3 5q0 0.9-0.3 1.7-0.4 0.8-1 1.5-0.7 0.6-1.5 1-0.8 0.3-1.7 0.3c-1.3 0-2.3-0.5-3.2-1.6q-0.3-0.4-0.7-0.4-0.4 0-0.7 0.2-0.4 0.3-0.4 0.7 0 0.4 0.2 0.7 2 2.4 4.8 2.4 1.3 0 2.5-0.5 1.2-0.5 2.1-1.4 0.9-0.9 1.4-2.1 0.5-1.2 0.5-2.5c0-2 0.7-2.7 1.7-3.6 1.2-1.2 2.8-2.7 2.8-6.9 0-2.9-1.2-5.7-3.2-7.8-2.1-2-4.9-3.2-7.8-3.2-2.9 0-5.7 1.2-7.8 3.2-2 2.1-3.2 4.9-3.2 7.8zm4.8 7.1q0.1-0.1 0.3-0.1 0.2 0 0.4 0 0.2 0.1 0.4 0.2 0.1 0.1 0.2 0.3 0.2 0.3 0.5 0.4 0.3 0.2 0.7 0.1 0.3-0.1 0.5-0.4 0.2-0.3 0.2-0.6c0-1.2-0.6-2-1.3-2.9-0.8-1.1-1.7-2.3-1.7-4.1 0-1.6 0.6-3.1 1.8-4.2 1.1-1.2 2.6-1.8 4.2-1.8 1.6 0 3.1 0.6 4.2 1.8 1.2 1.1 1.8 2.6 1.8 4.2q0 0.4-0.3 0.7-0.3 0.3-0.7 0.3-0.4 0-0.7-0.3-0.3-0.3-0.3-0.7c0-1.1-0.4-2.1-1.2-2.8-0.7-0.8-1.7-1.2-2.8-1.2-1.1 0-2.1 0.4-2.8 1.2-0.8 0.7-1.2 1.7-1.2 2.8 0 1.2 0.6 2 1.3 2.9 0.8 1.1 1.7 2.3 1.7 4.1 0 0.7-0.2 1.3-0.6 1.8-0.4 0.5-1 0.9-1.6 1.1-0.7 0.2-1.3 0.1-1.9-0.1-0.7-0.3-1.2-0.7-1.5-1.3q-0.1-0.2-0.1-0.4 0-0.2 0-0.4 0.1-0.1 0.2-0.3 0.1-0.2 0.3-0.3zm10-11.7c1.2 1 2 2.4 2.2 4 0.1 1.6-0.3 3.2-1.3 4.4-1 1.2-2.5 2-4.1 2.2-1.5 0.2-3.1-0.3-4.4-1.3q-0.3-0.3-0.3-0.7-0.1-0.4 0.2-0.7 0.2-0.3 0.7-0.4c0.2 0 0.5 0 0.7 0.2 0.4 0.5 1.9 1 2.9 0.9 1.1-0.1 2-0.6 2.7-1.4 0.7-0.9 1-1.9 0.9-3-0.1-1-0.7-2-1.5-2.7-0.9-0.7-1.3-0.9-2.4-0.9"/>
</svg>`;

const dir = 'src-tauri/icons';

async function run() {
  const sizes = [16, 32, 48, 64, 128, 256, 512];
  const pngs = {};

  for (const s of sizes) {
    const buf = await sharp(Buffer.from(whiteSvg))
      .resize(s, s, { kernel: sharp.kernel.lanczos3 })
      .png()
      .toBuffer();
    pngs[s] = buf;
    fs.writeFileSync(`${dir}/${s}x${s}.png`, buf);
    console.log(`${s}x${s}.png ${buf.length}b`);
  }

  // icon.png = 512px (Tauri tray icon)
  fs.writeFileSync(`${dir}/icon.png`, pngs[512]);
  console.log('icon.png = 512px');

  // Build proper ICO with embedded RGBA PNGs
  const icoSizes = [16, 32, 48, 256];
  const icoPngs = icoSizes.map(s => pngs[s]);
  const count = icoSizes.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  let dataOffset = 6 + count * 16;
  const entries = [];
  for (let i = 0; i < count; i++) {
    const s = icoSizes[i];
    const entry = Buffer.alloc(16);
    entry.writeUInt8(s < 256 ? s : 0, 0);
    entry.writeUInt8(s < 256 ? s : 0, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(icoPngs[i].length, 8);
    entry.writeUInt32LE(dataOffset, 12);
    dataOffset += icoPngs[i].length;
    entries.push(entry);
  }
  const ico = Buffer.concat([header, ...entries, ...icoPngs]);
  fs.writeFileSync(`${dir}/icon.ico`, ico);
  console.log(`icon.ico ${ico.length}b (${count} sizes: ${icoSizes.join(', ')})`);

  // Windows Store icons
  const winSizes = [30, 44, 71, 89, 107, 142, 150, 284, 310];
  for (const s of winSizes) {
    const buf = await sharp(Buffer.from(whiteSvg))
      .resize(s, s, { kernel: sharp.kernel.lanczos3 })
      .png()
      .toBuffer();
    fs.writeFileSync(`${dir}/Square${s}x${s}Logo.png`, buf);
  }
  const storeBuf = await sharp(Buffer.from(whiteSvg))
    .resize(50, 50, { kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
  fs.writeFileSync(`${dir}/StoreLogo.png`, storeBuf);
  console.log('Windows Store icons done');

  // favicon
  fs.writeFileSync('public/favicon.png', pngs[256]);
  console.log('public/favicon.png = 256px');
}

run().catch(console.error);
