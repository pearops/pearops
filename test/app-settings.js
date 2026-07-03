const assert = require('assert')
const { defaultSettings, parseDiscoveryFlushTimeout, normalizeSettings } = require('../src/app/settings')

// defaultSettings
const defaults = defaultSettings()
assert.equal(defaults.displayName, 'Responder')
assert.equal(defaults.notifications, true)
assert.equal(defaults.compact, true)
assert.equal(defaults.theme, 'system')
assert.equal(defaults.defaultSeverity, 'SEV-2')
assert.equal(defaults.defaultEventType, 'update')
assert.equal(defaults.discoveryFlushTimeout, 250)
assert.equal(defaults.blindPeers, '')

// parseDiscoveryFlushTimeout
assert.equal(parseDiscoveryFlushTimeout(100), 100)
assert.equal(parseDiscoveryFlushTimeout(50), 50)
assert.equal(parseDiscoveryFlushTimeout(2500), 2500)
assert.equal(parseDiscoveryFlushTimeout(10), 50, 'clamps to min 50')
assert.equal(parseDiscoveryFlushTimeout(3000), 2500, 'clamps to max 2500')
assert.equal(parseDiscoveryFlushTimeout('invalid'), 250, 'NaN defaults to 250')
assert.equal(parseDiscoveryFlushTimeout(null), 250, 'null defaults to 250')
assert.equal(parseDiscoveryFlushTimeout(undefined), 250, 'undefined defaults to 250')
assert.equal(parseDiscoveryFlushTimeout(''), 250, 'empty string defaults to 250')
assert.equal(parseDiscoveryFlushTimeout('0'), 50, 'string 0 clamps to min 50')
assert.equal(parseDiscoveryFlushTimeout('1000'), 1000, 'string number parsed correctly')

// normalizeSettings
const normalized = normalizeSettings({ displayName: 'Test' })
assert.equal(normalized.displayName, 'Test')
assert.equal(normalized.theme, 'system', 'preserves default theme')
assert.equal(normalized.discoveryFlushTimeout, 250, 'preserves default timeout')

const withExisting = normalizeSettings({ displayName: 'New' }, { theme: 'dark' })
assert.equal(withExisting.theme, 'dark', 'merges with existing')
assert.equal(withExisting.displayName, 'New', 'overrides displayName')

const withTimeout = normalizeSettings({ discoveryFlushTimeout: 1000 })
assert.equal(withTimeout.discoveryFlushTimeout, 1000, 'accepts valid timeout')

const clamped = normalizeSettings({ discoveryFlushTimeout: 5000 })
assert.equal(clamped.discoveryFlushTimeout, 2500, 'clamps timeout to max')

console.log(JSON.stringify({ ok: true, tests: 20 }))
