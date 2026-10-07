import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { MotionConfig } from 'framer-motion'
import ErrorBoundary from './components/ErrorBoundary'
import '@fontsource-variable/inter'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <MotionConfig reducedMotion="user"><App /></MotionConfig>
    </ErrorBoundary>
  </React.StrictMode>
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const base = import.meta.env.BASE_URL || '/'
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(err => {
      console.warn('SW registration failed', err)
    })
  })
}
