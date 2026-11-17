// 由 docs/icon.svg 產生各尺寸 PNG（一般圖示加圓角，maskable 與 apple 保持滿版方形）
const { createRequire } = require('module');
// 用法：node tools/make-icons.cjs   （改了 docs/icon.svg 後重跑）
const repo = require("path").resolve(__dirname, "..");
const sharp = createRequire(repo + '/package.json')('sharp');
const fs = require('fs');
const svg = fs.readFileSync(repo + '/docs/icon.svg');
const round = (n) => Buffer.from(`<svg width="${n}" height="${n}"><rect width="${n}" height="${n}" rx="${n * 0.22}" fill="#fff"/></svg>`);
(async () => {
  for (const [file, n, r] of [['icon-192.png', 192, true], ['icon-512.png', 512, true], ['icon-maskable-512.png', 512, false], ['apple-touch-icon.png', 180, false]]) {
    let img = sharp(svg, { density: 300 }).resize(n, n);
    if (r) img = sharp(await img.png().toBuffer()).composite([{ input: round(n), blend: 'dest-in' }]);
    await img.png({ compressionLevel: 9 }).toFile(`${repo}/docs/${file}`);
    console.log(file, fs.statSync(`${repo}/docs/${file}`).size, 'bytes');
  }
})();
