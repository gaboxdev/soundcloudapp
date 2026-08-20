import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installDom, installStorage } from './stub.ts'

installStorage()
installDom()

const { sanitizeSettings, settingsDefaults } = await import('../src/core/settings.ts')

test('ajustes: una entrada vacía devuelve los valores por defecto', () => {
  const s = sanitizeSettings({})
  assert.deepEqual(s, settingsDefaults())
})

test('ajustes: basura absoluta no rompe', () => {
  assert.deepEqual(sanitizeSettings(null), settingsDefaults())
  assert.deepEqual(sanitizeSettings('texto'), settingsDefaults())
  assert.deepEqual(sanitizeSettings(42), settingsDefaults())
})

test('ajustes: un tema inventado cae al de por defecto', () => {
  assert.equal(sanitizeSettings({ theme: 'neón' }).theme, settingsDefaults().theme)
  assert.equal(sanitizeSettings({ theme: 'light' }).theme, 'light')
})

test('ajustes: acentos válidos e inválidos', () => {
  assert.equal(sanitizeSettings({ accent: 'soundcloud' }).accent, 'soundcloud')
  assert.equal(sanitizeSettings({ accent: 'fucsia' }).accent, settingsDefaults().accent)
})

test('ajustes: el volumen se recorta a 0..1', () => {
  assert.equal(sanitizeSettings({ volume: 3 }).volume, 1)
  assert.equal(sanitizeSettings({ volume: -2 }).volume, 0)
  assert.equal(sanitizeSettings({ volume: 'alto' }).volume, settingsDefaults().volume)
  assert.equal(sanitizeSettings({ volume: 0.42 }).volume, 0.42)
})

test('ajustes: la velocidad solo acepta las de la lista', () => {
  assert.equal(sanitizeSettings({ rate: 1.5 }).rate, 1.5)
  assert.equal(sanitizeSettings({ rate: 3 }).rate, 1)
  assert.equal(sanitizeSettings({ rate: '1.25' }).rate, 1.25)
})

test('ajustes: apiBase valida la URL y quita la barra final', () => {
  assert.equal(sanitizeSettings({ apiBase: 'https://p.dev/' }).apiBase, 'https://p.dev')
  assert.equal(sanitizeSettings({ apiBase: 'no-una-url' }).apiBase, '')
  assert.equal(sanitizeSettings({ apiBase: '   ' }).apiBase, '')
})

test('ajustes: el ecualizador se normaliza a cinco bandas de ±12 dB', () => {
  const eq = sanitizeSettings({ eq: [99, -99, 'x', 3.14159] }).eq
  assert.equal(eq.length, 5)
  assert.equal(eq[0], 12)
  assert.equal(eq[1], -12)
  assert.equal(eq[2], 0)
  assert.equal(eq[3], 3.1)
  assert.equal(eq[4], 0)
})

test('ajustes: el crossfade se recorta a 0..12 y se redondea', () => {
  assert.equal(sanitizeSettings({ crossfade: 99 }).crossfade, 12)
  assert.equal(sanitizeSettings({ crossfade: -4 }).crossfade, 0)
  assert.equal(sanitizeSettings({ crossfade: 6.44 }).crossfade, 6.4)
})

test('ajustes: el presupuesto sin conexión solo acepta los valores ofrecidos', () => {
  assert.equal(sanitizeSettings({ offlineBudget: 1000 }).offlineBudget, 1000)
  assert.equal(sanitizeSettings({ offlineBudget: 777 }).offlineBudget, 500)
  assert.equal(sanitizeSettings({ offlineBudget: 0 }).offlineBudget, 0)
})

test('ajustes: los interruptores exigen booleanos de verdad', () => {
  assert.equal(sanitizeSettings({ dsp: 'sí' }).dsp, settingsDefaults().dsp)
  assert.equal(sanitizeSettings({ dsp: false }).dsp, false)
  assert.equal(sanitizeSettings({ notifyTrack: 1 }).notifyTrack, false)
})

test('ajustes: el tono se normaliza a 0..359', () => {
  assert.equal(sanitizeSettings({ accentHue: 400 }).accentHue, 40)
  assert.equal(sanitizeSettings({ accentHue: -30 }).accentHue, 330)
  assert.equal(sanitizeSettings({ accentHue: 'azul' }).accentHue, settingsDefaults().accentHue)
})

test('ajustes: la versión siempre queda en la actual', () => {
  assert.equal(sanitizeSettings({ version: 1 }).version, settingsDefaults().version)
})

test('ajustes: una versión antigua conserva lo que sigue siendo válido', () => {
  const viejo = { version: 2, theme: 'light', volume: 0.3, glass: 'cristal' }
  const s = sanitizeSettings(viejo)
  assert.equal(s.theme, 'light')
  assert.equal(s.volume, 0.3)
  assert.equal(s.glass, 'cristal')
  assert.equal(s.version, settingsDefaults().version)
  assert.equal(s.offlineBudget, settingsDefaults().offlineBudget)
})
