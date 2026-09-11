// Builds the dev bundle's icon: the app icon under a yellow DEV band, so the
// dock, cmd-tab and finder tell the dev channel apart from the installed app.
// "atop" clips the band to the icon's own shape, keeping its rounded corners.
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const CANVAS = 1024;
const BAND_TOP = 700;
const BAND_HEIGHT = 200;
// Halved for @2x, so the iconset covers 16 through 1024.
const SIZES = [16, 32, 128, 256, 512];

const band = Buffer.from(
  `<svg width="${CANVAS}" height="${CANVAS}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect x="0" y="${BAND_TOP}" width="${CANVAS}" height="${BAND_HEIGHT}" fill="#f5c518"/>` +
    `<text x="${CANVAS / 2}" y="${BAND_TOP + 148}" font-family="Helvetica,Arial,sans-serif"` +
    ` font-size="150" font-weight="bold" letter-spacing="12" text-anchor="middle" fill="#141414">DEV</text>` +
  `</svg>`,
);

export async function buildDevIcns(sourcePng, outIcns, outPng) {
  const { default: sharp } = await import("sharp");
  const badged = await sharp(sourcePng).resize(CANVAS, CANVAS)
    .composite([{ input: band, blend: "atop" }]).png().toBuffer();

  // macOS caches bundle icons hard, so the dev app also sets this at runtime.
  if (outPng) await sharp(badged).toFile(outPng);

  const work = mkdtempSync(path.join(os.tmpdir(), "deck-dev-icon-"));
  const iconset = path.join(work, "icon.iconset");
  mkdirSync(iconset);
  try {
    for (const size of SIZES) {
      await sharp(badged).resize(size, size).toFile(path.join(iconset, `icon_${size}x${size}.png`));
      await sharp(badged).resize(size * 2, size * 2).toFile(path.join(iconset, `icon_${size}x${size}@2x.png`));
    }
    execSync(`iconutil -c icns '${iconset}' -o '${outIcns}'`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
