const fs = require('fs')
const path = require('path')
const PearRuntime = require('pear-runtime')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const goodbye = require('graceful-goodbye')
const FramedStream = require('framed-stream')

const { PearOpsPeer } = require('../src/peer')

const pipe = new FramedStream(Bare.IPC)

const updaterConfig = {
  dir: Bare.argv[2],
  app: Bare.argv[3],
  updates: Bare.argv[4] !== 'false',
  version: Bare.argv[5],
  upgrade: Bare.argv[6],
  name: Bare.argv[7]
}

const appStorage = updaterConfig.dir
const runtimeStore = new Corestore(path.join(appStorage, 'pear-runtime/corestore'))
const updateSwarm = new Hyperswarm()
const pear = new PearRuntime({ ...updaterConfig, swarm: updateSwarm, store: runtimeStore })

pear.updater.on('error', console.error)
if (updaterConfig.updates !== false) {
  updateSwarm.on('connection', connection => runtimeStore.replicate(connection))
  updateSwarm.join(pear.updater.drive.core.discoveryKey, { client: true, server: false })
}

const stateFile = path.join(appStorage, 'pearops-state.json')
let localState = loadState()
let peer = null
let activeIncidentId = localState.activeIncidentId || null

function loadState () {
  try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')) } catch { return { incidents: [], settings: { displayName: 'Responder', compact: true, notifications: true } } }
}

function saveState () {
  fs.mkdirSync(appStorage, { recursive: true })
  fs.writeFileSync(stateFile, JSON.stringify(localState, null, 2))
}

function incidentStorage (incidentId) {
  return path.join(appStorage, 'incidents', incidentId)
}

function emitState () {
  pipe.write(JSON.stringify({ type: 'state', state: snapshot() }))
}

function snapshot () {
  const peerSnap = peer ? peer.snapshot() : null
  return {
    incidents: localState.incidents,
    activeIncidentId,
    active: peerSnap,
    settings: localState.settings || {},
    app: { version: updaterConfig.version, storage: appStorage }
  }
}

function upsertIncident (record) {
  const idx = localState.incidents.findIndex(i => i.id === record.id || i.roomKey === record.roomKey)
  if (idx === -1) localState.incidents.unshift(record)
  else localState.incidents[idx] = { ...localState.incidents[idx], ...record }
  localState.activeIncidentId = record.id
  activeIncidentId = record.id
  saveState()
}

function syncActiveMetadata () {
  if (!peer || !activeIncidentId) return
  const snap = peer.snapshot()
  const meta = snap.metadata || {}
  upsertIncident({
    id: activeIncidentId,
    roomKey: snap.roomKey,
    title: meta.title || 'Untitled incident',
    severity: meta.severity || 'SEV2',
    status: meta.status || 'investigating',
    updatedAt: snap.timeline.at(-1)?.timestamp || new Date().toISOString(),
    joinedAt: localState.incidents.find(i => i.id === activeIncidentId)?.joinedAt || new Date().toISOString()
  })
}

async function openPeerForIncident (incident) {
  if (peer) await peer.close().catch(() => {})
  peer = new PearOpsPeer({
    name: localState.settings?.displayName || 'Responder',
    storage: incidentStorage(incident.id)
  })
  peer.on('snapshot', () => { syncActiveMetadata(); emitState() })
  peer.on('event', () => { syncActiveMetadata(); emitState() })
  peer.on('peers', emitState)
  await peer.joinRoom({ roomKey: incident.roomKey })
  activeIncidentId = incident.id
  localState.activeIncidentId = incident.id
  syncActiveMetadata()
  emitState()
}

async function createIncident (payload) {
  const id = `inc-${Date.now()}-${Math.random().toString(16).slice(2)}`
  if (peer) await peer.close().catch(() => {})
  peer = new PearOpsPeer({ name: localState.settings?.displayName || 'Responder', storage: incidentStorage(id) })
  peer.on('snapshot', () => { syncActiveMetadata(); emitState() })
  peer.on('event', () => { syncActiveMetadata(); emitState() })
  peer.on('peers', emitState)
  const snap = await peer.createRoom({ title: payload.title, severity: payload.severity, status: payload.status || 'investigating' })
  upsertIncident({ id, roomKey: snap.roomKey, title: snap.metadata.title, severity: snap.metadata.severity, status: snap.metadata.status, joinedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
  emitState()
  return snapshot()
}

async function joinIncident (payload) {
  const id = `inc-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const record = { id, roomKey: payload.roomKey, title: payload.title || 'Joined incident', severity: payload.severity || 'SEV2', status: 'joined', joinedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  upsertIncident(record)
  await openPeerForIncident(record)
  return snapshot()
}

async function handle (msg) {
  if (msg.type === 'pear:applyUpdate') {
    await pear.updater.applyUpdate()
    pipe.write('pear:updateApplied')
    return
  }
  const { id, method, params = {} } = msg
  try {
    let result
    if (method === 'getState') result = snapshot()
    else if (method === 'createIncident') result = await createIncident(params)
    else if (method === 'joinIncident') result = await joinIncident(params)
    else if (method === 'selectIncident') {
      const incident = localState.incidents.find(i => i.id === params.id)
      if (!incident) throw new Error('incident not found')
      result = await openPeerForIncident(incident)
    } else if (method === 'removeIncident') {
      localState.incidents = localState.incidents.filter(i => i.id !== params.id)
      if (activeIncidentId === params.id) { activeIncidentId = null; localState.activeIncidentId = null; if (peer) await peer.close(); peer = null }
      saveState(); result = snapshot(); emitState()
    } else if (method === 'postEvent') result = await peer.postEvent(params)
    else if (method === 'setStatus') result = await peer.setStatus(params.status)
    else if (method === 'saveSettings') { localState.settings = { ...(localState.settings || {}), ...params }; saveState(); result = snapshot(); emitState() }
    else throw new Error(`unknown method ${method}`)
    pipe.write(JSON.stringify({ type: 'response', id, result }))
  } catch (err) {
    pipe.write(JSON.stringify({ type: 'response', id, error: err.message }))
  }
}

pipe.on('data', data => {
  try { handle(JSON.parse(data.toString())).catch(console.error) } catch (err) { console.error(err) }
})

goodbye(async () => {
  await peer?.close().catch(() => {})
  await updateSwarm.destroy()
  await pear.close()
  await runtimeStore.close()
})

pipe.write(JSON.stringify({ type: 'ready', state: snapshot() }))
