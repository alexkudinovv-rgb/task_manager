// Company icons for the PWA from /logo.svg (kept out of git): npm run icons -w apps/web
// Writes apps/web/public/brand/, also git-ignored. Server builds pick it up when it exists (vite.config.ts);
// the GitHub Pages demo and fresh clones keep the placeholders in public/icons.
import { copyFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const logo = fileURLToPath(new URL('../../../logo.svg', import.meta.url))
const out = fileURLToPath(new URL('../public/brand/', import.meta.url))
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 }
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 }

if (!existsSync(logo)) {
  console.error(`Нет ${logo}: положите логотип в корень репозитория.`)
  process.exit(1)
}
await mkdir(out, { recursive: true })

/** The round logo, `scale` of a `size` square, centred on `background`. */
async function icon(name, size, scale, background) {
  const inner = Math.round(size * scale)
  const art = await sharp(logo, { density: 600 }).resize(inner, inner, { fit: 'contain', background: CLEAR }).png().toBuffer()
  await sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: art, gravity: 'centre' }])
    .png()
    .toFile(`${out}${name}`)
}

await icon('icon-192.png', 192, 1, CLEAR)
await icon('icon-512.png', 512, 1, CLEAR)
// Maskable: launchers crop to any shape inside the central 80% circle.
await icon('maskable-192.png', 192, 0.8, WHITE)
await icon('maskable-512.png', 512, 0.8, WHITE)
// iOS fills transparency with black and rounds the corners itself.
await icon('apple-touch-icon.png', 180, 0.9, WHITE)
await copyFile(logo, `${out}icon.svg`)
console.log(`Иконки готовы: ${out}`)
