import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const BG = [15, 15, 16]
const C1 = [255, 85, 0]
const C2 = [255, 45, 120]
const BAR_HEIGHTS = [0.3, 0.62, 0.95, 0.8, 0.5, 0.36]

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

function render(size) {
  const radius = Math.round(size * 0.18)
  const bgSize = Math.round(size * 0.86)
  const bgOffset = Math.round((size - bgSize) / 2)
  const barWidth = Math.round(size * 0.082)
  const barGap = Math.round(size * 0.047)
  const maxBar = Math.round(size * 0.52)
  const logoWidth = barWidth * BAR_HEIGHTS.length + barGap * (BAR_HEIGHTS.length - 1)
  const logoX = Math.round((size - logoWidth) / 2)
  const baseline = Math.round((size + maxBar) / 2)

  const raw = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const inBg = inRoundedRect(x, y, size, radius)
      if (!inBg) continue
      let r = BG[0]
      let g = BG[1]
      let b = BG[2]
      for (let bar = 0; bar < BAR_HEIGHTS.length; bar++) {
        const bx = logoX + bar * (barWidth + barGap)
        const barH = Math.round(maxBar * BAR_HEIGHTS[bar])
        if (x >= bx && x < bx + barWidth && y >= baseline - barH && y < baseline) {
          const t = bar / (BAR_HEIGHTS.length - 1)
          const color = lerp(C1, C2, t)
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
writePng(icon1024, 1024)
writePng(icon512, 512)
