function defaultSettings () {
  return {
    displayName: 'Responder',
    notifications: true,
    compact: true,
    theme: 'system',
    defaultSeverity: 'SEV-2',
    defaultEventType: 'update',
    discoveryFlushTimeout: 250,
    blindPeers: ''
  }
}

function parseDiscoveryFlushTimeout (value) {
  if (value === null || value === undefined || value === '') return 250
  const num = Number(value)
  if (!Number.isFinite(num)) return 250
  return Math.max(50, Math.min(2500, num))
}

function normalizeSettings (incoming, existing = {}) {
  const base = { ...defaultSettings(), ...existing }
  const next = { ...base, ...incoming }

  next.discoveryFlushTimeout = parseDiscoveryFlushTimeout(next.discoveryFlushTimeout)
  next.displayName = next.displayName || 'Responder'
  next.theme = next.theme || 'system'
  next.defaultSeverity = next.defaultSeverity || 'SEV-2'
  next.defaultEventType = next.defaultEventType || 'update'

  return next
}

module.exports = { defaultSettings, parseDiscoveryFlushTimeout, normalizeSettings }
