const EventEmitter = require('events')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const Hyperdrive = require('hyperdrive')
const b4a = require('b4a')

function topicFromRoomKey (roomKey) {
  if (!roomKey) return crypto.randomBytes(32)
  const cleaned = String(roomKey).trim().replace(/^pearops:/, '')
  if (/^[0-9a-f]{64}$/i.test(cleaned)) return Buffer.from(cleaned, 'hex')
  return crypto.createHash('sha256').update(cleaned).digest()
}

function roomKeyFromTopic (topic) {
  return `pearops:${b4a.toString(topic, 'hex')}`
}

function jsonLineSocket (socket, onMessage) {
  let buffer = ''
  socket.on('data', data => {
    buffer += data.toString('utf8')
    let idx
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line) continue
      try { onMessage(JSON.parse(line)) } catch {}
    }
  })
  return obj => {
    if (!socket.destroyed) socket.write(JSON.stringify(obj) + '\n')
  }
}

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

    // Pear/P2P-specific: a separate replication swarm is dedicated to Corestore.
    // Corestore owns the Hypercore/Hyperdrive protocol stream, while the control
    // swarm exchanges room metadata and writer/drive keys as small JSON lines.
    this.replicationSwarm.on('connection', conn => {
      conn.on('error', () => {})
      this.store.replicate(conn)
    })
    this.controlSwarm.on('connection', (conn, info) => this._onControlConnection(conn, info))
    this.controlSwarm.on('update', () => this.emit('peers', this.peerCount()))
    this.replicationSwarm.on('update', () => this.emit('peers', this.peerCount()))
  }

  peerCount () {
    return Math.max(this.controlSwarm.connections.size, this.replicationSwarm.connections.size)
  }

  async createRoom ({ title, severity = 'SEV2', status = 'investigating' }) {
    return this.joinRoom({ title, severity, status, create: true })
  }

  async joinRoom ({ roomKey, title, severity, status, create = false }) {
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

    if (create) {
      this.metadata = {
        title: title || 'Untitled incident',
        severity,
        status,
        createdAt: new Date().toISOString(),
        creator: this.name
      }
      await this._append({ type: 'room-meta', message: `Incident created: ${this.metadata.title}`, metadata: this.metadata })
    }

    const c = this.controlSwarm.join(this.roomTopic, { client: true, server: true })
    const r = this.replicationSwarm.join(this.roomTopic, { client: true, server: true })
    // Pear/Hyperswarm-specific: DHT announce flushing can take a while or hang on
    // restricted networks. Keep the UI responsive; peers still connect as soon as
    // discovery succeeds.
    await Promise.race([
      Promise.allSettled([c.flushed(), r.flushed()]),
      new Promise(resolve => setTimeout(resolve, 2500))
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
    this.metadata = { ...(this.metadata || {}), status }
    return this._append({ type: 'status', eventType: 'decision', message: `Status changed to ${status}`, metadata: this.metadata })
  }

  async _append (partial) {
    const event = {
      id: crypto.randomUUID(),
      author: this.name,
      timestamp: new Date().toISOString(),
      eventType: partial.eventType || partial.type || 'update',
      message: partial.message || '',
      attachment: partial.attachment || null,
      metadata: partial.metadata || null,
      writerKey: b4a.toString(this.writer.key, 'hex')
    }
    await this.writer.append(event)
    this._ingest(event)
    this._broadcast({ kind: 'event-hint', writerKey: event.writerKey })
    return event
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
    return [...this.events.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  }

  snapshot () {
    return {
      roomKey: this.roomKey,
      metadata: this.metadata,
      peerName: this.name,
      peers: this.peerCount(),
      writers: [...this.knownWriters],
      drives: [...this.knownDrives],
      timeline: this.timeline()
    }
  }

  async close () {
    if (this.pollTimer) clearInterval(this.pollTimer)
    await Promise.allSettled([this.controlSwarm.destroy(), this.replicationSwarm.destroy(), this.store.close()])
  }
}

module.exports = { PearOpsPeer, topicFromRoomKey, roomKeyFromTopic }
