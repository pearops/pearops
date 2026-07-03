const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')
const PearRuntime = require('pear-runtime')
const FramedStream = require('framed-stream')

const { isMac, isLinux, isWindows } = require('which-runtime')
const { command, flag } = require('paparam')
const pkg = require('../package.json')
const { PearOpsPeer } = require('../src/peer')
const { createKeetIdentity, identityStatus, exportMnemonic, restoreMnemonic } = require('../src/identity')
const { defaultSettings, normalizeSettings, parseDiscoveryFlushTimeout } = require('../src/app/settings')
const { loadLocalState: loadStateFile, saveLocalState: saveStateFile } = require('../src/app/local-state')
const { createIncidentId, upsertIncident, removeIncident, findIncident } = require('../src/app/incidents')
const { name, productName, version, upgrade } = pkg

const protocol = name
const mainWorkerSpecifier = '/workers/main.js'

const workers = new Map()

const appName = productName ?? name

const cmd = command(
  appName,
  flag('--storage <dir>', 'pass custom storage to pear-runtime'),
  flag('--no-updates', 'start without OTA updates'),
  flag('--no-sandbox', 'start without Chromium sandbox').hide()
)

cmd.parse(app.isPackaged ? process.argv.slice(1) : process.argv.slice(2))

const pearStore = cmd.flags.storage
const updates = cmd.flags.updates

if (pearStore) app.setPath('userData', pearStore)

ipcMain.on('pkg', (evt) => {
  evt.returnValue = pkg
})

function getAppPath() {
  if (!app.isPackaged) return null
  if (isLinux && process.env.APPIMAGE) return process.env.APPIMAGE
  if (isWindows) return process.execPath
  return path.join(process.resourcesPath, '..', '..')
}

function sendToAll(name, data) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(name, data)
  }
}

const pearOpsService = {
  started: false,
  appStorage: null,
  stateFile: null,
  identityStorage: null,
  localState: null,
  identitySnapshot: null,
  peer: null,
  activeIncidentId: null,
  switching: false,
  stateTimer: null
}

function loadLocalState () {
  const state = loadStateFile(pearOpsService.stateFile, {
    incidents: [],
    settings: defaultSettings()
  })
  return {
    ...state,
    incidents: state.incidents || [],
    settings: normalizeSettings(state.settings || {})
  }
}

function saveLocalState () {
  saveStateFile(pearOpsService.stateFile, pearOpsService.localState)
}

function pearOpsSnapshot () {
  return {
    incidents: pearOpsService.localState?.incidents || [],
    activeIncidentId: pearOpsService.activeIncidentId,
    active: pearOpsService.peer ? pearOpsService.peer.snapshot() : null,
    identity: pearOpsService.identitySnapshot || { configured: false },
    settings: pearOpsService.localState?.settings || {},
    app: { version, storage: pearOpsService.appStorage }
  }
}

function sendPearOpsState () {
  if (pearOpsService.stateTimer) clearTimeout(pearOpsService.stateTimer)
  pearOpsService.stateTimer = setTimeout(() => {
    pearOpsService.stateTimer = null
    sendToAll('pear:worker:ipc:' + mainWorkerSpecifier, Buffer.from(JSON.stringify({ type: 'state', state: pearOpsSnapshot() })))
  }, 40)
}

function sendPearOpsStateNow () {
  if (pearOpsService.stateTimer) clearTimeout(pearOpsService.stateTimer)
  pearOpsService.stateTimer = null
  sendToAll('pear:worker:ipc:' + mainWorkerSpecifier, Buffer.from(JSON.stringify({ type: 'state', state: pearOpsSnapshot() })))
}

async function refreshPearOpsIdentity () {
  pearOpsService.identitySnapshot = await identityStatus(pearOpsService.identityStorage).catch(err => ({
    configured: false,
    mnemonicPath: path.join(pearOpsService.identityStorage, 'identity-mnemonic.txt'),
    error: err.message
  }))
  return pearOpsService.identitySnapshot
}

function ensurePearOpsIdentity () {
  if (!pearOpsService.identitySnapshot?.configured) throw new Error('Set up or restore your Keet identity before joining incidents')
}

function upsertPearOpsIncident (record) {
  pearOpsService.localState.incidents = upsertIncident(pearOpsService.localState.incidents, record)
  pearOpsService.activeIncidentId = record.id
  pearOpsService.localState.activeIncidentId = record.id
  saveLocalState()
}

function syncPearOpsActiveMetadata () {
  if (!pearOpsService.peer || !pearOpsService.activeIncidentId || pearOpsService.switching) return
  const snap = pearOpsService.peer.snapshot()
  const meta = snap.metadata || {}
  const current = pearOpsService.localState.incidents.find(i => i.id === pearOpsService.activeIncidentId) || {}
  upsertPearOpsIncident({
    id: pearOpsService.activeIncidentId,
    roomKey: snap.roomKey || current.roomKey,
    title: meta.title || current.title || 'Joined incident',
    severity: meta.severity || current.severity || 'SEV-2',
    status: meta.status || current.status || 'investigating',
    updatedAt: snap.timeline.at(-1)?.timestamp || current.updatedAt || new Date().toISOString(),
    joinedAt: current.joinedAt || new Date().toISOString()
  })
}

function incidentStorage (incidentId) {
  return path.join(pearOpsService.appStorage, 'incidents', incidentId)
}

function wirePearOpsPeer (peer) {
  peer.on('snapshot', () => { if (peer !== pearOpsService.peer) return; syncPearOpsActiveMetadata(); sendPearOpsState() })
  peer.on('event', () => { if (peer !== pearOpsService.peer) return; syncPearOpsActiveMetadata(); sendPearOpsState() })
  peer.on('peers', () => { if (peer === pearOpsService.peer) sendPearOpsState() })
}

function activePeerOptions (incidentId) {
  const settings = normalizeSettings(pearOpsService.localState.settings || {})
  return {
    name: settings.displayName || 'Responder',
    storage: incidentStorage(incidentId),
    identityStorage: pearOpsService.identityStorage,
    discoveryFlushTimeout: parseDiscoveryFlushTimeout(settings.discoveryFlushTimeout),
    blindPeerKeys: settings.blindPeers || ''
  }
}

async function openPearOpsIncident (incident) {
  if (pearOpsService.activeIncidentId === incident.id && pearOpsService.peer?.roomKey === incident.roomKey) return
  pearOpsService.activeIncidentId = incident.id
  pearOpsService.localState.activeIncidentId = incident.id
  saveLocalState()
  sendPearOpsStateNow()
  pearOpsService.switching = true
  const previousPeer = pearOpsService.peer
  pearOpsService.peer = null
  if (previousPeer) await previousPeer.close().catch(() => {})
  pearOpsService.peer = new PearOpsPeer(activePeerOptions(incident.id))
  wirePearOpsPeer(pearOpsService.peer)
  pearOpsService.switching = false
  await pearOpsService.peer.joinRoom({ roomKey: incident.roomKey })
  syncPearOpsActiveMetadata()
  sendPearOpsStateNow()
}

async function handlePearOpsMethod (method, params = {}) {
  if (method === 'getState') return pearOpsSnapshot()
  if (method === 'setupIdentity') {
    const bundle = await createKeetIdentity(pearOpsService.identityStorage, { mnemonic: params.mnemonic })
    await refreshPearOpsIdentity()
    return { ...pearOpsSnapshot(), generatedMnemonic: params.mnemonic ? null : bundle.mnemonic }
  }
  if (method === 'createIdentity') {
    const bundle = await createKeetIdentity(pearOpsService.identityStorage)
    await refreshPearOpsIdentity()
    return { ...pearOpsSnapshot(), generatedMnemonic: bundle.mnemonic }
  }
  if (method === 'exportIdentity') {
    return await exportMnemonic(pearOpsService.identityStorage)
  }
  if (method === 'restoreIdentity') {
    await restoreMnemonic(pearOpsService.identityStorage, params.mnemonic)
    await refreshPearOpsIdentity()
    return pearOpsSnapshot()
  }
  if (method === 'createIncident') {
    ensurePearOpsIdentity()
    const id = createIncidentId()
    if (pearOpsService.peer) await pearOpsService.peer.close().catch(() => {})
    pearOpsService.activeIncidentId = id
    pearOpsService.localState.activeIncidentId = id
    pearOpsService.peer = new PearOpsPeer(activePeerOptions(id))
    wirePearOpsPeer(pearOpsService.peer)
    const snap = await pearOpsService.peer.createRoom({ title: params.title, severity: params.severity, status: params.status || 'investigating' })
    upsertPearOpsIncident({ id, roomKey: snap.roomKey, title: snap.metadata.title, severity: snap.metadata.severity, status: snap.metadata.status, joinedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    if (params.description?.trim()) await pearOpsService.peer.postEvent({ eventType: 'update', message: params.description.trim() })
    syncPearOpsActiveMetadata()
    sendPearOpsState()
    return pearOpsSnapshot()
  }
  if (method === 'joinIncident') {
    ensurePearOpsIdentity()
    const id = createIncidentId()
    const record = { id, roomKey: params.roomKey, title: params.title || 'Joined incident', severity: params.severity || 'SEV2', status: 'joined', joinedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    upsertPearOpsIncident(record)
    await openPearOpsIncident(record)
    if (params.description?.trim()) await pearOpsService.peer.postEvent({ eventType: 'update', message: params.description.trim() })
    syncPearOpsActiveMetadata()
    sendPearOpsState()
    return pearOpsSnapshot()
  }
  if (method === 'selectIncident') {
    const incident = findIncident(pearOpsService.localState.incidents, params.id)
    if (!incident) throw new Error('incident not found')
    await openPearOpsIncident(incident)
    return pearOpsSnapshot()
  }
  if (method === 'removeIncident') {
    pearOpsService.localState.incidents = removeIncident(pearOpsService.localState.incidents, params.id)
    if (pearOpsService.activeIncidentId === params.id) {
      pearOpsService.activeIncidentId = null
      pearOpsService.localState.activeIncidentId = null
      if (pearOpsService.peer) await pearOpsService.peer.close().catch(() => {})
      pearOpsService.peer = null
    }
    saveLocalState(); sendPearOpsState(); return pearOpsSnapshot()
  }
  if (method === 'postEvent') {
    await pearOpsService.peer.postEvent(params)
    syncPearOpsActiveMetadata()
    sendPearOpsState()
    return pearOpsSnapshot()
  }
  if (method === 'setStatus') {
    await pearOpsService.peer.setStatus(params.status)
    syncPearOpsActiveMetadata()
    sendPearOpsState()
    return pearOpsSnapshot()
  }
  if (method === 'saveSettings') {
    const nextSettings = normalizeSettings(params, pearOpsService.localState.settings || {})
    pearOpsService.localState.settings = nextSettings
    if (pearOpsService.peer) pearOpsService.peer.name = nextSettings.displayName || 'Responder'
    saveLocalState(); sendPearOpsStateNow(); return pearOpsSnapshot()
  }
  throw new Error(`unknown method ${method}`)
}

async function startPearOpsService () {
  if (pearOpsService.started) return pearOpsSnapshot()
  pearOpsService.started = true
  pearOpsService.appStorage = app.getPath('userData')
  pearOpsService.stateFile = path.join(pearOpsService.appStorage, 'pearops-state.json')
  pearOpsService.identityStorage = path.join(pearOpsService.appStorage, 'identity')
  pearOpsService.localState = loadLocalState()
  pearOpsService.activeIncidentId = pearOpsService.localState.activeIncidentId || null
  await refreshPearOpsIdentity()
  sendToAll('pear:worker:ipc:' + mainWorkerSpecifier, Buffer.from(JSON.stringify({ type: 'ready', state: pearOpsSnapshot() })))
  return pearOpsSnapshot()
}

async function handlePearOpsRPC (data) {
  await startPearOpsService()
  let msg
  try { msg = JSON.parse(Buffer.isBuffer(data) ? data.toString() : String(data)) } catch { return false }
  const { id, method, params = {} } = msg
  try {
    const result = await handlePearOpsMethod(method, params)
    const response = { type: 'response', id, result }
    sendToAll('pear:worker:ipc:' + mainWorkerSpecifier, Buffer.from(JSON.stringify(response)))
    return response
  } catch (err) {
    const response = { type: 'response', id, error: err.message }
    sendToAll('pear:worker:ipc:' + mainWorkerSpecifier, Buffer.from(JSON.stringify(response)))
    return response
  }
}

app.on('before-quit', () => {
  if (pearOpsService.peer) pearOpsService.peer.close().catch(() => {})
})

function getWorker(specifier) {
  if (workers.has(specifier)) return workers.get(specifier)
  const appPath = getAppPath()
  let dir = null
  if (pearStore) {
    console.log('pear store: ' + pearStore)
    dir = pearStore
  } else if (appPath === null) {
    dir = path.join(os.tmpdir(), 'pear', appName)
  } else {
    const isSnap = !!process.env.SNAP_USER_COMMON
    const linuxConfigHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
    dir = isMac
      ? path.join(os.homedir(), 'Library', 'Application Support', appName)
      : isLinux
        ? isSnap
          ? path.join(process.env.SNAP_USER_COMMON, appName)
          : path.join(linuxConfigHome, appName)
        : path.join(os.homedir(), 'AppData', 'Roaming', appName)
  }

  const extension = isLinux ? '.AppImage' : isMac ? '.app' : '.msix'

  const worker = PearRuntime.run(require.resolve('..' + specifier), [
    dir,
    appPath,
    updates,
    version,
    upgrade,
    productName + extension
  ])
  const pipe = new FramedStream(worker)

  function sendWorkerStdout(data) {
    sendToAll('pear:worker:stdout:' + specifier, data)
  }
  function sendWorkerStderr(data) {
    sendToAll('pear:worker:stderr:' + specifier, data)
  }
  function sendWorkerIPC(data) {
    sendToAll('pear:worker:ipc:' + specifier, data)
  }
  function onBeforeQuit() {
    pipe.destroy()
  }
  ipcMain.handle('pear:worker:writeIPC:' + specifier, (evt, data) => {
    return pipe.write(data)
  })
  workers.set(specifier, pipe)
  pipe.on('data', sendWorkerIPC)
  worker.stdout.on('data', sendWorkerStdout)
  worker.stderr.on('data', sendWorkerStderr)
  worker.once('exit', (code) => {
    app.removeListener('before-quit', onBeforeQuit)
    ipcMain.removeHandler('pear:worker:writeIPC:' + specifier)
    pipe.removeListener('data', sendWorkerIPC)
    worker.stdout.removeListener('data', sendWorkerStdout)
    worker.stderr.removeListener('data', sendWorkerStderr)
    sendToAll('pear:worker:exit:' + specifier, code)
    workers.delete(specifier)
  })
  app.on('before-quit', onBeforeQuit)
  return pipe
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: 'PearOps',
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron', 'preload.js'),
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  const devServerUrl = process.env.PEAR_DEV_SERVER_URL

  if (devServerUrl) {
    await win.loadURL(devServerUrl)
    win.webContents.openDevTools()
    return
  }

  await win.loadFile(path.join(__dirname, '..', 'renderer', 'dist', 'index.html'))
}

ipcMain.handle('pear:applyUpdate', () => false)
ipcMain.handle('pear:startWorker', async (evt, filename) => {
  if (filename === mainWorkerSpecifier) {
    return startPearOpsService()
  }
  getWorker(filename)
  return true
})
ipcMain.handle('pear:worker:writeIPC:' + mainWorkerSpecifier, async (evt, data) => {
  return handlePearOpsRPC(data)
})
ipcMain.handle('app:afterUpdate', () => {
  if (isLinux && process.env.APPIMAGE) {
    app.relaunch({
      execPath: process.env.APPIMAGE,
      args: [
        '--appimage-extract-and-run',
        ...process.argv.slice(1).filter((arg) => arg !== '--appimage-extract-and-run')
      ]
    })
  } else if (!isWindows) {
    app.relaunch()
  }
  app.quit()
})

function handleDeepLink(url) {
  console.log('deep link:', url)
}

app.setAsDefaultProtocolClient(protocol)

app.on('open-url', (evt, url) => {
  evt.preventDefault()
  handleDeepLink(url)
})

const lock = app.requestSingleInstanceLock()

if (!lock) {
  app.quit()
} else {
  app.on('second-instance', (evt, args) => {
    const url = args.find((arg) => arg.startsWith(protocol + '://'))
    if (url) handleDeepLink(url)
  })

  app.whenReady().then(() => {
    createWindow().catch((err) => {
      console.error('Failed to create window:', err)
      app.quit()
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow().catch((err) => {
          console.error('Failed to create window:', err)
        })
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
