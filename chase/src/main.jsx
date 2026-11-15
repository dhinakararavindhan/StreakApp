import React from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import '@fontsource-variable/plus-jakarta-sans'
import App from './App.jsx'
import './styles.css'
import { applyTheme, getTheme } from './util.js'

applyTheme(getTheme())
registerSW({ immediate: true })
createRoot(document.getElementById('root')).render(<App />)
