import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const BG = [11, 11, 15]
const MARK = [255, 255, 255]
const BAR_W = 0.0859375
const BAR_GAP = 0.0546875
const BAR_HEIGHTS = [0.203125, 0.40625, 0.609375, 0.40625, 0.203125]
const SUPERSAMPLE = 4

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
  const radius = size * 0.219
  const barW = size * BAR_W
  const barGap = size * BAR_GAP
  const total = BAR_HEIGHTS.length * barW + (BAR_HEIGHTS.length - 1) * barGap
  const barStart = (size - total) / 2
  const mid = size / 2
  const step = 1 / SUPERSAMPLE
  const first = step / 2
  const perPixel = SUPERSAMPLE * SUPERSAMPLE

  const bars = BAR_HEIGHTS.map((height, index) => {
    const x0 = barStart + index * (barW + barGap)
    const barH = height * size
    return { x0, x1: x0 + barW, y0: mid - barH / 2, y1: mid + barH / 2, r: barW / 2 }
  })

  const raw = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inside = 0
      let onBar = 0
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        const py = y + first + sy * step
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const px = x + first + sx * step
          if (!inRoundedRect(px, py, size, radius)) continue
          inside++
          for (const bar of bars) {
            if (inPill(px, py, bar.x0, bar.x1, bar.y0, bar.y1, bar.r)) {
              onBar++
              break
            }
          }
        }
      }
      if (inside === 0) continue
      const t = onBar / inside
      const i = (y * size + x) * 4
      raw[i] = Math.round(BG[0] + (MARK[0] - BG[0]) * t)
      raw[i + 1] = Math.round(BG[1] + (MARK[1] - BG[1]) * t)
      raw[i + 2] = Math.round(BG[2] + (MARK[2] - BG[2]) * t)
      raw[i + 3] = Math.round((inside / perPixel) * 255)
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
