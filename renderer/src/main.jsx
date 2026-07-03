import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.jsx'
import { usePearOps } from './hooks/usePearOps.js'
import { resetPearOpsClient } from './lib/pearops-client.js'
import './styles.css'

function MissingBridge () {
  return (
    <div style={{ padding: '40px', fontFamily: 'system-ui', textAlign: 'center' }}>
      <h1>PearOps</h1>
      <p>This app requires the Electron bridge to run.</p>
      <p>Start with: <code>npm run start:dev</code> or <code>npm start</code></p>
    </div>
  )
}

const root = createRoot(document.getElementById('root'))

if (typeof window.bridge === 'undefined') {
  root.render(<MissingBridge />)
} else {
  root.render(<App usePearOps={usePearOps} />)
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    root.unmount()
    resetPearOpsClient()
  })
}
