import './styles/design.css'
import { bootstrapApp } from './app'
import { initSettings } from './core/settings'
import './views/home'
import './views/charts'
import './views/search'
import './views/track'
import './views/playlist'
import './views/user'
import './views/queue'
import './views/likes'
import './views/settings'

initSettings()
bootstrapApp()

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
