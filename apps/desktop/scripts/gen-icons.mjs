import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const BG = [15, 15, 16]
const C1 = [255, 85, 0]
const C2 = [255, 45, 120]
const TRI = { x0: 0.21, y0: 0.402, x1: 0.21, y1: 0.598, x2: 0.395, y2: 0.5 }
const TRI_CORNER_R = 0.027
const BAR_W = 0.068
const BAR_GAP = 0.048
const BAR_START = 0.48
const BAR_BASELINE = 0.586
const BAR_HEIGHTS = [0.117, 0.258, 0.18]

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
  const x0 = radius
  const y0 = radius
  const x1 = size - radius
  const y1 = size - radius
  if (x < x0 || x >= x1 || y < y0 || y >= y1) {
    const cx = x < x0 ? x0 : x1
    const cy = y < y0 ? y0 : y1
    const dx = x - cx
    const dy = y - cy
    return dx * dx + dy * dy <= radius * radius
  }
  return true
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

function pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by)
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy)
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay)
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
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
  const radius = Math.round(size * 0.18)
  const tx0 = size * TRI.x0
  const ty0 = size * TRI.y0
  const tx1 = size * TRI.x1
  const ty1 = size * TRI.y1
  const tx2 = size * TRI.x2
  const ty2 = size * TRI.y2
  const triR = size * TRI_CORNER_R
  const barW = size * BAR_W
  const barGap = size * BAR_GAP
  const barStart = size * BAR_START
  const baseline = size * BAR_BASELINE
  const glowR = size * 0.5

  const raw = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const inBg = inRoundedRect(x, y, size, radius)
      if (!inBg) continue
      const glow = 1 - dist(x, y, size / 2, size / 2) / glowR
      const base = glow > 0 ? lerp(BG, C1, 0.16 * glow * glow) : BG
      let r = base[0]
      let g = base[1]
      let b = base[2]
      const rounded =
        pointInTriangle(x, y, tx0, ty0, tx1, ty1, tx2, ty2) &&
        dist(x, y, tx0, ty0) >= triR &&
        dist(x, y, tx1, ty1) >= triR &&
        dist(x, y, tx2, ty2) >= triR
      if (rounded) {
        const t = (y - ty0) / (ty1 - ty0)
        const color = lerp(C1, C2, t)
        r = color[0]
        g = color[1]
        b = color[2]
      } else {
        for (let bar = 0; bar < BAR_HEIGHTS.length; bar++) {
          const x0 = barStart + bar * (barW + barGap)
          const barH = BAR_HEIGHTS[bar] * size
          const y0 = baseline - barH
          if (inPill(x, y, x0, x0 + barW, y0, baseline, barW / 2)) {
            const color = lerp(C1, C2, bar / (BAR_HEIGHTS.length - 1))
            r = color[0]
            g = color[1]
            b = color[2]
            break
          }
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
