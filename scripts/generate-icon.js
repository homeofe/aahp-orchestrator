#!/usr/bin/env node
// Generates a 128x128 PNG extension icon for the VS Code Marketplace.
// Uses only Node.js built-ins + buffer-crc32 (already in node_modules via vsce).

const zlib = require('zlib')
const { writeFileSync, mkdirSync } = require('fs')
const path = require('path')

// CRC32 implementation (avoids external dep)
const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  CRC_TABLE[n] = c
}
function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const payload = Buffer.concat([typeBuf, data])
  const crcVal = crc32(payload)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crcVal, 0)
  return Buffer.concat([len, payload, crcBuf])
}

const W = 128, H = 128
const pixels = Buffer.alloc(W * H * 4) // RGBA

// Color palette
const BG = [30, 41, 59]        // Slate-800
const ACCENT = [56, 189, 248]  // Sky-400
const WHITE = [255, 255, 255]
const DARK = [15, 23, 42]      // Slate-900

function setPixel(x, y, r, g, b, a = 255) {
  if (x < 0 || x >= W || y < 0 || y >= H) return
  const i = (y * W + x) * 4
  pixels[i] = r
  pixels[i + 1] = g
  pixels[i + 2] = b
  pixels[i + 3] = a
}

function fillRect(x0, y0, w, h, color) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      setPixel(x, y, color[0], color[1], color[2])
    }
  }
}

function fillCircle(cx, cy, r, color) {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const dx = x - cx, dy = y - cy
      if (dx * dx + dy * dy <= r * r) {
        setPixel(x, y, color[0], color[1], color[2])
      }
    }
  }
}

function fillRoundRect(x0, y0, w, h, r, color) {
  // Fill center
  fillRect(x0 + r, y0, w - 2 * r, h, color)
  fillRect(x0, y0 + r, r, h - 2 * r, color)
  fillRect(x0 + w - r, y0 + r, r, h - 2 * r, color)
  // Corners
  fillCircle(x0 + r, y0 + r, r, color)
  fillCircle(x0 + w - r - 1, y0 + r, r, color)
  fillCircle(x0 + r, y0 + h - r - 1, r, color)
  fillCircle(x0 + w - r - 1, y0 + h - r - 1, r, color)
}

// Background with rounded corners
fillRoundRect(0, 0, W, H, 16, BG)

// Robot head (rounded rect)
fillRoundRect(30, 22, 68, 56, 10, ACCENT)

// Inner face area
fillRoundRect(36, 28, 56, 44, 6, DARK)

// Eyes (two bright circles)
fillCircle(52, 46, 7, ACCENT)
fillCircle(76, 46, 7, ACCENT)

// Eye highlights
fillCircle(50, 44, 3, WHITE)
fillCircle(74, 44, 3, WHITE)

// Mouth (smile line)
for (let x = 48; x <= 80; x++) {
  const yBase = 58 + Math.round(2 * Math.sin((x - 48) / 32 * Math.PI))
  setPixel(x, yBase, ACCENT[0], ACCENT[1], ACCENT[2])
  setPixel(x, yBase + 1, ACCENT[0], ACCENT[1], ACCENT[2])
}

// Antenna
fillRect(62, 10, 4, 14, ACCENT)
fillCircle(64, 8, 5, ACCENT)
fillCircle(64, 8, 3, WHITE)

// Body (small rectangle below head)
fillRoundRect(38, 82, 52, 28, 6, ACCENT)

// Body inner
fillRoundRect(42, 86, 44, 20, 4, DARK)

// Body details - three horizontal lines
for (let i = 0; i < 3; i++) {
  fillRect(50, 90 + i * 5, 28, 2, ACCENT)
}

// Build PNG
const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0)
ihdr.writeUInt32BE(H, 4)
ihdr[8] = 8   // bit depth
ihdr[9] = 6   // color type: RGBA
ihdr[10] = 0  // compression
ihdr[11] = 0  // filter
ihdr[12] = 0  // interlace

// Raw scanlines with filter byte
const raw = Buffer.alloc(H * (1 + W * 4))
for (let y = 0; y < H; y++) {
  const rowOff = y * (1 + W * 4)
  raw[rowOff] = 0 // filter: none
  pixels.copy(raw, rowOff + 1, y * W * 4, (y + 1) * W * 4)
}

const compressed = zlib.deflateSync(raw, { level: 9 })

const png = Buffer.concat([
  sig,
  makeChunk('IHDR', ihdr),
  makeChunk('IDAT', compressed),
  makeChunk('IEND', Buffer.alloc(0)),
])

const outPath = path.join(__dirname, '..', 'assets', 'icon.png')
mkdirSync(path.dirname(outPath), { recursive: true })
writeFileSync(outPath, png)
console.log(`Icon written to ${outPath} (${png.length} bytes)`)
