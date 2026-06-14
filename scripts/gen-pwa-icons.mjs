/*
 * Generate PWA icons from public/images/logo.svg → public/icons/*.png
 * Run: node scripts/gen-pwa-icons.mjs
 *
 * any-purpose icons: logo on white with a small margin.
 * maskable icons: extra safe-zone padding so Android's mask never clips it.
 * (These are reasonable defaults; the owner can replace with bespoke art.)
 */
import { mkdirSync, readFileSync } from "node:fs";
import sharp from "sharp";

const SVG = readFileSync("public/images/logo.svg");
const OUT = "public/icons";
mkdirSync(OUT, { recursive: true });

async function gen(size, name, padRatio) {
  const inner = Math.round(size * (1 - padRatio));
  const logo = await sharp(SVG)
    .resize(inner, inner, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toFile(`${OUT}/${name}`);
  console.log(`  ${name} (${size}x${size})`);
}

await gen(192, "icon-192.png", 0.12);
await gen(512, "icon-512.png", 0.12);
await gen(192, "icon-192-maskable.png", 0.24);
await gen(512, "icon-512-maskable.png", 0.24);
console.log("PWA icons written to public/icons/");
