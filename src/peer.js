const EventEmitter = require('events')
const fs = require('fs')
const path = require('path')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const Hyperdrive = require('hyperdrive')
const b4a = require('b4a')
const { createKeetIdentity, proofToJSON } = require('./identity')
const { topicFromRoomKey, roomKeyFromTopic } = require('./p2p/room-key')
const { parseBlindPeerKeys } = require('./p2p/blind-peers')
const { jsonLineSocket } = require('./p2p/json-line-socket')
const {
  createIncidentDeclaration,
  normalizeSeverity,
  normalizeLifecycleState,
  transitionIncidentState,
  deriveRoleAssignments,
  getMissingRequiredRoles,
  getAllIncidentRoles,
  createRoleAssignmentEvent,
  normalizeIncidentRole,
  compareTimelineEvents
} = require('./app/incidents')

class PearOpsPeer extends EventEmitter {
  constructor (opts = {}) {
    super()
    this.name = opts.name || process.env.USER || 'peer'
    this.storage = opts.storage || (global.Pear?.config?.storage) || path.join(process.cwd(), '.pearops', this.name)
    this.store = new Corestore(path.join(this.storage, 'corestore'))
    this.controlSwarm = new Hyperswarm()
    this.replicationSwarm = new Hyperswarm()
    this.roomTopic = null
    this.roomKey = null
    this.metadata = null
    this.writer = null
    this.drive = null
    this.events = new Map()
    this.writerCores = new Map()
    this.drives = new Map()
    this.knownWriters = new Set()
    this.knownDrives = new Set()
    this.controlSenders = new Set()
    this.pollTimer = null
    this.blindPeerKeys = parseBlindPeerKeys(opts.blindPeerKeys || process.env.PEAROPS_BLIND_PEERS)
    this.blindPeerAnnounce = !!opts.blindPeerAnnounce
    this.blindPeering = null
    this.blindRegistered = new Set()
    this.blindRegistrationErrors = []
    this.identityBundle = null
    this.identityStorage = opts.identityStorage || path.join(this.storage, 'identity')
    this.discoveryFlushTimeout = opts.discoveryFlushTimeout ?? 2500
    this.closing = false

    // Pear/P2P-specific: a separate replication swarm is dedicated to Corestore.
    // Corestore owns the Hypercore/Hyperdrive protocol stream, while the control
    // swarm exchanges room metadata and writer/drive keys as small JSON lines.
    this.replicationSwarm.on('connection', conn => {
      conn.on('error', () => {})
      if (this.closing) return conn.destroy()
      try { this.store.replicate(conn) } catch { conn.destroy() }
    })
    this.controlSwarm.on('connection', (conn, info) => this._onControlConnection(conn, info))
    this.controlSwarm.on('update', () => this.emit('peers', this.peerCount()))
    this.replicationSwarm.on('update', () => this.emit('peers', this.peerCount()))

    if (this.blindPeerKeys.length) this._enableBlindPeering()
  }

  peerCount () {
    return Math.max(this.controlSwarm.connections.size, this.replicationSwarm.connections.size)
  }

  async createRoom ({ title, severity = 'SEV-2', description, affectedServices, declaredBy }) {
    return this.joinRoom({ title, severity, description, affectedServices, declaredBy, create: true })
  }

  async joinRoom ({ roomKey, title, severity, description, affectedServices, declaredBy, create = false }) {
    if (!this.identityBundle) this.identityBundle = await createKeetIdentity(this.identityStorage, { requireExisting: true })
    this.roomTopic = topicFromRoomKey(create ? null : roomKey)
    this.roomKey = roomKeyFromTopic(this.roomTopic)
    fs.mkdirSync(this.storage, { recursive: true })

    this.writer = this.store.get({ name: `writer-${this.roomKey}`, valueEncoding: 'json' })
    await this.writer.ready()
    this.drive = new Hyperdrive(this.store.namespace(`drive-${this.roomKey}`))
    await this.drive.ready()

    await this._addWriter(this.writer.key)
    const ownDriveKey = b4a.toString(this.drive.key, 'hex')
    this.knownDrives.add(ownDriveKey)
    this.drives.set(ownDriveKey, this.drive)
    this._registerBlindCore(this.writer, 'timeline-writer')
    this._registerBlindDrive(this.drive)

    if (create) {
      // Use new incident declaration helper for rich metadata
      const incident = createIncidentDeclaration({
        title,
        description: description || '',
        severity: normalizeSeverity(severity, 'SEV-2'),
        affectedServices,
        declaredBy: declaredBy || this.name,
        now: new Date().toISOString()
      })
      this.metadata = {
        ...incident,
        roomId: this.roomKey
        // Severity definitions served by /api/severities for configurable overrides
      }
      await this._append({ type: 'room-meta', eventType: 'incident-declared', message: `Incident declared: ${this.metadata.title} (${this.metadata.severity})`, metadata: this.metadata })
    }

    const c = this.controlSwarm.join(this.roomTopic, { client: true, server: true })
    const r = this.replicationSwarm.join(this.roomTopic, { client: true, server: true })
    // Pear/Hyperswarm-specific: DHT announce flushing can take a while or hang on
    // restricted networks. Keep the UI responsive; peers still connect as soon as
    // discovery succeeds.
    await Promise.race([
      Promise.allSettled([c.flushed(), r.flushed()]),
      new Promise(resolve => setTimeout(resolve, this.discoveryFlushTimeout))
    ])
    this._broadcastHello()
    this._startPolling()
    this.emit('room', this.snapshot())
    return this.snapshot()
  }

  async postEvent ({ eventType = 'update', message, attachment = null }) {
    if (!message && !attachment) throw new Error('message or attachment required')
    return this._append({ type: eventType, message: message || `Attached ${attachment.name}`, attachment })
  }

  async attachFile (filePath, originalName) {
    if (!this.drive) throw new Error('join or create a room first')
    const name = originalName || path.basename(filePath)
    const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const drivePath = `/attachments/${Date.now()}-${safe}`
    const data = await fs.promises.readFile(filePath)
    await this.drive.put(drivePath, data, { metadata: { name } })
    const attachment = {
      name,
      path: drivePath,
      size: data.length,
      driveKey: b4a.toString(this.drive.key, 'hex')
    }
    await this.postEvent({ eventType: 'update', message: `Attached ${name}`, attachment })
    await this._registerBlindDrive(this.drive)
    this._broadcastHello()
    return attachment
  }

  async getAttachment ({ driveKey, attachmentPath }) {
    const drive = await this._addDrive(Buffer.from(driveKey, 'hex'))
    await Promise.race([
      drive.update({ wait: true }).catch(() => false),
      new Promise(resolve => setTimeout(resolve, 3000))
    ])
    const data = await drive.get(attachmentPath, { wait: true, timeout: 15000 })
    if (!data) throw new Error('attachment not found yet; keep peers online and retry')
    return data
  }

  async setStatus (status) {
    const normalizedState = normalizeLifecycleState(status)
    const previousState = this.metadata?.state || this.metadata?.status || 'declared'
    if (this.metadata) {
      this.metadata = transitionIncidentState(this.metadata, normalizedState, this.name)
    } else {
      this.metadata = { ...(this.metadata || {}), status: normalizedState, state: normalizedState }
    }
    return this._append({ type: 'status', eventType: 'state-transition', message: `State changed from ${previousState} to ${normalizedState}`, metadata: this.metadata })
  }

  async assignRole ({ roleId, assignee, handoffNote }) {
    if (!this.writer) throw new Error('join or create a room first')
    const roles = deriveRoleAssignments(this.timeline(), this.metadata?.roles)
    const normalized = normalizeIncidentRole(roleId)
    if (!normalized) throw new Error(`Unknown role: ${roleId}`)
    const previousAssignee = roles[normalized] || null
    const normalizedAssignee = assignee ? String(assignee).trim() : null
    const normalizedHandoffNote = handoffNote ? String(handoffNote).trim() : null
    const roleEvent = createRoleAssignmentEvent({
      roleId: normalized,
      assignee: normalizedAssignee,
      previousAssignee,
      handoffNote: normalizedHandoffNote
    })
    await this._append({
      eventType: 'role-change',
      message: roleEvent.message,
      role: roleEvent.role
    })
    return this.snapshot()
  }

  async _append (partial) {
    const eventId = crypto.randomUUID()
    const timestamp = new Date().toISOString()
    // Build base payload for signing (backward compatible - role only when present)
    const signedPayload = {
      id: eventId,
      timestamp,
      eventType: partial.eventType || partial.type || 'update',
      message: partial.message || '',
      attachment: partial.attachment || null,
      metadata: partial.metadata || null
    }
    if (partial.role) signedPayload.role = partial.role
    const proof = this.identityBundle ? proofToJSON(this.identityBundle.sign(signedPayload)) : null
    const event = {
      id: eventId,
      author: this.name,
      timestamp,
      eventType: partial.eventType || partial.type || 'update',
      message: partial.message || '',
      attachment: partial.attachment || null,
      metadata: partial.metadata || null,
      role: partial.role || null,
      writerKey: b4a.toString(this.writer.key, 'hex'),
      identity: this.identityBundle ? {
        identityPublicKey: this.identityBundle.identityPublicKey,
        devicePublicKey: this.identityBundle.devicePublicKey,
        verified: true
      } : null,
      proof
    }
    await this.writer.append(event)
    this._ingest(event)
    this._registerBlindCore(this.writer, 'timeline-writer')
    this._broadcast({ kind: 'event-hint', writerKey: event.writerKey })
    return event
  }

  _enableBlindPeering () {
    if (this.blindPeering || !this.blindPeerKeys.length) return
    const BlindPeering = require('blind-peering')
    this.blindPeering = new BlindPeering(this.replicationSwarm.dht, this.store.namespace('blind-peering'), {
      keys: this.blindPeerKeys
    })
  }

  _registerBlindCore (core, label) {
    if (!this.blindPeering || !core?.key) return
    const id = `${label}:${b4a.toString(core.key, 'hex')}`
    if (this.blindRegistered.has(id)) return
    this.blindRegistered.add(id)
    this.blindPeering.addCore(core, { announce: this.blindPeerAnnounce }).catch(err => {
      this.blindRegistered.delete(id)
      this.blindRegistrationErrors.push({ label, message: err.message, at: new Date().toISOString() })
      this.blindRegistrationErrors = this.blindRegistrationErrors.slice(-5)
      this.emit('snapshot', this.snapshot())
    })
  }

  async _registerBlindDrive (drive) {
    if (!this.blindPeering || !drive) return
    this._registerBlindCore(drive.core, 'attachment-drive-db')
    try {
      const blobs = await drive.getBlobs()
      this._registerBlindCore(blobs.core, 'attachment-drive-blobs')
    } catch (err) {
      this.blindRegistrationErrors.push({ label: 'attachment-drive-blobs', message: err.message, at: new Date().toISOString() })
      this.blindRegistrationErrors = this.blindRegistrationErrors.slice(-5)
    }
  }

  async _addWriter (key) {
    const hex = b4a.toString(key, 'hex')
    if (this.writerCores.has(hex)) return this.writerCores.get(hex)
    this.knownWriters.add(hex)
    const core = this.store.get({ key, valueEncoding: 'json' })
    await core.ready()
    this.writerCores.set(hex, { core, read: 0 })
    this._readCore(hex).catch(() => {})
    this.emit('writers', [...this.knownWriters])
    return core
  }

  async _addDrive (key) {
    const hex = b4a.toString(key, 'hex')
    if (this.drives.has(hex)) return this.drives.get(hex)
    if (this.drive && b4a.equals(key, this.drive.key)) {
      this.knownDrives.add(hex)
      this.drives.set(hex, this.drive)
      return this.drive
    }
    this.knownDrives.add(hex)
    const drive = new Hyperdrive(this.store.namespace(`remote-drive-${hex}`), key)
    await drive.ready()
    this.drives.set(hex, drive)
    return drive
  }

  async _readCore (hex) {
    const rec = this.writerCores.get(hex)
    if (!rec) return
    const { core } = rec
    await core.update({ wait: false })
    while (rec.read < core.length) {
      const event = await core.get(rec.read, { wait: true, timeout: 5000 })
      rec.read++
      this._ingest(event)
    }
  }

  _ingest (event) {
    if (!event || !event.id || this.events.has(event.id)) return
    this.events.set(event.id, event)
    if (event.metadata) this.metadata = { ...(this.metadata || {}), ...event.metadata }
    if (event.proof && event.identity?.identityPublicKey && this.identityBundle) {
      // Try new payload format first (with role), then fall back to legacy (without role)
      const signedPayload = { id: event.id, timestamp: event.timestamp, eventType: event.eventType, message: event.message, attachment: event.attachment, metadata: event.metadata, role: event.role || null }
      const legacyPayload = { id: event.id, timestamp: event.timestamp, eventType: event.eventType, message: event.message, attachment: event.attachment, metadata: event.metadata }
      event.identity.verified = this.identityBundle.verify(event.proof, signedPayload, event.identity.identityPublicKey) || this.identityBundle.verify(event.proof, legacyPayload, event.identity.identityPublicKey)
    }
    if (event.attachment?.driveKey) this._addDrive(Buffer.from(event.attachment.driveKey, 'hex')).catch(() => {})
    this.emit('event', event)
    this.emit('snapshot', this.snapshot())
  }

  _onControlConnection (conn) {
    conn.on('error', () => {})
    const send = jsonLineSocket(conn, msg => this._onControlMessage(msg))
    this.controlSenders.add(send)
    conn.on('close', () => {
      this.controlSenders.delete(send)
      this.emit('peers', this.peerCount())
    })
    send(this._hello())
    this.emit('peers', this.peerCount())
  }

  _hello () {
    return {
      kind: 'hello',
      name: this.name,
      roomKey: this.roomKey,
      writerKey: this.writer && b4a.toString(this.writer.key, 'hex'),
      driveKey: this.drive && b4a.toString(this.drive.key, 'hex'),
      knownWriters: [...this.knownWriters],
      knownDrives: [...this.knownDrives],
      metadata: this.metadata
    }
  }

  _broadcastHello () { this._broadcast(this._hello()) }

  _broadcast (msg) {
    for (const send of this.controlSenders) send(msg)
  }

  async _onControlMessage (msg) {
    if (!msg || (msg.roomKey && msg.roomKey !== this.roomKey)) return
    if (msg.metadata && !this.metadata) this.metadata = msg.metadata
    const writers = [msg.writerKey, ...(msg.knownWriters || [])].filter(Boolean)
    const drives = [msg.driveKey, ...(msg.knownDrives || [])].filter(Boolean)
    await Promise.all(writers.map(k => this._addWriter(Buffer.from(k, 'hex')).catch(() => {})))
    await Promise.all(drives.map(k => this._addDrive(Buffer.from(k, 'hex')).catch(() => {})))
    if (msg.kind === 'hello') this._broadcast({ kind: 'keys', roomKey: this.roomKey, knownWriters: [...this.knownWriters], knownDrives: [...this.knownDrives] })
  }

  _startPolling () {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => {
      for (const hex of this.writerCores.keys()) this._readCore(hex).catch(() => {})
      this.emit('peers', this.peerCount())
    }, 1000)
  }

  timeline () {
    return [...this.events.values()].sort(compareTimelineEvents)
  }

  snapshot () {
    const timeline = this.timeline()
    const roleDefinitions = getAllIncidentRoles()
    const roles = deriveRoleAssignments(timeline, this.metadata?.roles)
    const missingRequiredRoles = getMissingRequiredRoles(roles)
    return {
      roomKey: this.roomKey,
      metadata: this.metadata,
      roles,
      roleDefinitions,
      missingRequiredRoles,
      roleWarnings: missingRequiredRoles.map(roleId => ({
        roleId,
        name: roleDefinitions[roleId].name,
        message: `${roleDefinitions[roleId].name} is not assigned`
      })),
      peerName: this.name,
      identity: this.identityBundle ? { identityPublicKey: this.identityBundle.identityPublicKey, devicePublicKey: this.identityBundle.devicePublicKey } : null,
      peers: this.peerCount(),
      writers: [...this.knownWriters],
      drives: [...this.knownDrives],
      blindPeer: {
        enabled: !!this.blindPeering,
        keys: this.blindPeerKeys,
        announce: this.blindPeerAnnounce,
        registeredCores: this.blindRegistered.size,
        errors: this.blindRegistrationErrors
      },
      timeline
    }
  }

  async close () {
    this.closing = true
    if (this.pollTimer) clearInterval(this.pollTimer)
    await Promise.allSettled([
      this.blindPeering && this.blindPeering.close(),
      this.controlSwarm.destroy(),
      this.replicationSwarm.destroy(),
      this.store.close()
    ])
  }
}

module.exports = { PearOpsPeer, topicFromRoomKey, roomKeyFromTopic, parseBlindPeerKeys }
