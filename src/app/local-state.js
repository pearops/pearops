const fs = require('fs')
const path = require('path')

function loadLocalState (stateFile, defaultState) {
  try {
    const data = fs.readFileSync(stateFile, 'utf8')
    const parsed = JSON.parse(data)
    return { ...defaultState, ...parsed }
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Failed to load state', err)
    return { ...defaultState }
  }
}

function saveLocalState (stateFile, state) {
  const dir = path.dirname(stateFile)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = stateFile + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2))
  fs.renameSync(tmp, stateFile)
}

module.exports = { loadLocalState, saveLocalState }
