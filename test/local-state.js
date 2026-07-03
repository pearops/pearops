const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { loadLocalState, saveLocalState } = require('../src/app/local-state')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearops-state-'))
const stateFile = path.join(tmpDir, 'state.json')

// loadLocalState with no file
const defaultState = { incidents: [], settings: { theme: 'light' } }
const loaded = loadLocalState(stateFile, defaultState)
assert.deepEqual(loaded, defaultState, 'returns default when file missing')

// saveLocalState creates file
const toSave = { incidents: [{ id: 'inc-1', title: 'Test' }], settings: { theme: 'dark' } }
saveLocalState(stateFile, toSave)
assert.ok(fs.existsSync(stateFile), 'state file created')

// loadLocalState reads saved file
const reloaded = loadLocalState(stateFile, defaultState)
assert.deepEqual(reloaded, toSave, 'reloads saved state')

// loadLocalState merges with defaults
const partialFile = path.join(tmpDir, 'partial.json')
fs.writeFileSync(partialFile, JSON.stringify({ incidents: [{ id: 'inc-2' }] }))
const merged = loadLocalState(partialFile, defaultState)
assert.deepEqual(merged.incidents, [{ id: 'inc-2' }])
assert.deepEqual(merged.settings, { theme: 'light' }, 'merges settings from default')

// saveLocalState handles nested dirs
const nestedFile = path.join(tmpDir, 'nested', 'dir', 'state.json')
saveLocalState(nestedFile, { test: true })
assert.ok(fs.existsSync(nestedFile), 'creates nested directories')

// Cleanup
fs.rmSync(tmpDir, { recursive: true, force: true })

console.log(JSON.stringify({ ok: true, tests: 7 }))
