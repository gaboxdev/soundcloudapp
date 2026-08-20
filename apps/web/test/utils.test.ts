import { test } from 'node:test'
import assert from 'node:assert/strict'
import { artworkUrl, clamp, esc, fmtBytes, fmtCount, fmtTime, initials, timeAgo } from '../src/core/utils.ts'

test('fmtTime formatea milisegundos', () => {
  assert.equal(fmtTime(0), '0:00')
  assert.equal(fmtTime(9000), '0:09')
  assert.equal(fmtTime(75000), '1:15')
  assert.equal(fmtTime(3661000), '61:01')
})

test('fmtTime aguanta valores inválidos', () => {
  assert.equal(fmtTime(Number.NaN), '0:00')
  assert.equal(fmtTime(-5), '0:00')
})

test('fmtCount abrevia miles y millones', () => {
  assert.equal(fmtCount(0), '0')
  assert.equal(fmtCount(999), '999')
  assert.equal(fmtCount(1500), '1.5K')
  assert.equal(fmtCount(1500000), '1.5M')
  assert.equal(fmtCount(null), '—')
  assert.equal(fmtCount(undefined), '—')
})

test('initials respeta los emojis y los acentos', () => {
  assert.equal(initials('Ana Pérez'), 'AP')
  assert.equal(initials('deadmau5'), 'DE')
  assert.equal(initials('🎧 música'), '🎧M')
  assert.equal(initials(''), '?')
  assert.equal(initials('   '), '?')
})

test('artworkUrl cambia el tamaño y devuelve null si no hay', () => {
  assert.equal(artworkUrl('https://i1.sndcdn.com/x-large.jpg', 't500x500'), 'https://i1.sndcdn.com/x-t500x500.jpg')
  assert.equal(artworkUrl(null), null)
  assert.equal(artworkUrl(undefined), null)
})

test('clamp no se sale de rango', () => {
  assert.equal(clamp(5, 0, 1), 1)
  assert.equal(clamp(-5, 0, 1), 0)
  assert.equal(clamp(0.4, 0, 1), 0.4)
})

test('esc escapa lo que puede romper el HTML', () => {
  assert.equal(esc('<script>'), '&lt;script&gt;')
  assert.equal(esc('a & b'), 'a &amp; b')
  assert.equal(esc('"x"'), '&quot;x&quot;')
  assert.equal(esc(null), '')
})

test('fmtBytes usa KB, MB y GB', () => {
  assert.equal(fmtBytes(0), '0 MB')
  assert.equal(fmtBytes(2048), '2 KB')
  assert.equal(fmtBytes(5 * 1024 * 1024), '5 MB')
  assert.equal(fmtBytes(2.5 * 1024 * 1024 * 1024), '2.5 GB')
})

test('timeAgo devuelve algo legible y no revienta con basura', () => {
  const hace = new Date(Date.now() - 3 * 60 * 1000).toISOString()
  assert.match(timeAgo(hace), /min/)
  assert.equal(timeAgo(null), '')
  assert.equal(timeAgo('no-fecha'), '')
})
