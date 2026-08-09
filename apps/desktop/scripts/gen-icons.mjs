import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const BG = [15, 15, 16]
const C1 = [255, 85, 0]
const C2 = [255, 45, 120]
const BAR_W = 0.076
const BAR_GAP = 0.051
const BAR_HEIGHTS = [0.199, 0.34, 0.461, 0.34, 0.199]

function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]
    for (let k = 0; k < 8; k++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}

function inRoundedRect(x, y, size, radius) {
  const cx = Math.min(Math.max(x, radius), size - radius)
  const cy = Math.min(Math.max(y, radius), size - radius)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= radius * radius
}

function lerp(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

function dist(x1, y1, x2, y2) {
  return Math.hypot(x1 - x2, y1 - y2)
}

function inPill(px, py, x0, x1, y0, y1, r) {
  const cx = (x0 + x1) / 2
  const dx = px - cx
  const dyTop = py - (y0 + r)
  if (dyTop < 0) return dx * dx + dyTop * dyTop <= r * r
  const dyBot = py - (y1 - r)
  if (dyBot > 0) return dx * dx + dyBot * dyBot <= r * r
  return Math.abs(dx) <= r
}

function render(size) {
  const radius = Math.round(size * 0.219)
  const barW = size * BAR_W
  const barGap = size * BAR_GAP
  const total = BAR_HEIGHTS.length * barW + (BAR_HEIGHTS.length - 1) * barGap
  const barStart = (size - total) / 2
  const mid = size / 2
  const glowR = size * 0.5

  const raw = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      if (!inRoundedRect(x, y, size, radius)) continue
      const glow = 1 - dist(x, y, mid, mid) / glowR
      const base = glow > 0 ? lerp(BG, C1, 0.14 * glow * glow) : BG
      let r = base[0]
      let g = base[1]
      let b = base[2]
      for (let bar = 0; bar < BAR_HEIGHTS.length; bar++) {
        const x0 = barStart + bar * (barW + barGap)
        const barH = BAR_HEIGHTS[bar] * size
        if (inPill(x, y, x0, x0 + barW, mid - barH / 2, mid + barH / 2, barW / 2)) {
          const color = lerp(C1, C2, bar / (BAR_HEIGHTS.length - 1))
          r = color[0]
          g = color[1]
          b = color[2]
          break
        }
      }
      raw[i] = r
      raw[i + 1] = g
      raw[i + 2] = b
      raw[i + 3] = 255
    }
  }
  return raw
}

function writePng(path, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const scanlines = Buffer.alloc(size * (size * 4 + 1))
  const raw = render(size)
  for (let y = 0; y < size; y++) {
    scanlines[y * (size * 4 + 1)] = 0
    raw.copy(scanlines, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(scanlines, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, png)
  console.log(`icono generado: ${path} (${size}x${size}, ${png.length} bytes)`)
}

const targets = process.argv.slice(2)
const icon1024 = resolve('src-tauri/icons/icon.png')
const icon512 = resolve('../web/public/icon-512.png')
const appleTouch = resolve('../web/public/apple-touch-icon.png')
writePng(icon1024, 1024)
writePng(icon512, 512)
writePng(appleTouch, 180)
