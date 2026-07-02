const express = require('express')
const multer = require('multer')
const os = require('os')
const path = require('path')
const fs = require('fs')
const qrcode = require('qrcode-terminal')
const { PearOpsPeer } = require('./peer')

function arg (name, fallback) {
  // npm appends arguments after the script's built-in flags, e.g.
  // `npm run peer:a -- --port 3921` becomes `... --port 3911 ... --port 3921`.
  // Use the last occurrence so demo-time overrides work as expected.
  const idx = process.argv.lastIndexOf(`--${name}`)
  return idx >= 0 ? process.argv[idx + 1] : fallback
}

async function main () {
  const port = Number(arg('port', process.env.PORT || 3911))
  const name = arg('name', os.hostname())
  const storage = arg('storage', path.join(process.cwd(), '.pearops', name))
  const openBrowser = process.argv.includes('--open')
  const app = express()
  const upload = multer({ dest: path.join(storage, 'uploads') })
  const peer = new PearOpsPeer({ name, storage })
  const clients = new Set()

  app.use(express.json())
  app.use(express.static(path.join(__dirname, '..', 'public')))

  function push (event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const res of clients) res.write(payload)
  }

  peer.on('snapshot', snap => push('snapshot', snap))
  peer.on('event', event => push('timeline-event', event))
  peer.on('peers', () => push('snapshot', peer.snapshot()))

  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.write(`event: snapshot\ndata: ${JSON.stringify(peer.snapshot())}\n\n`)
    clients.add(res)
    req.on('close', () => clients.delete(res))
  })

  app.get('/api/state', (req, res) => res.json(peer.snapshot()))

  app.post('/api/create', async (req, res, next) => {
    try {
      res.json(await peer.createRoom(req.body || {}))
    } catch (err) { next(err) }
  })

  app.post('/api/join', async (req, res, next) => {
    try {
      res.json(await peer.joinRoom({ roomKey: req.body.roomKey }))
    } catch (err) { next(err) }
  })

  app.post('/api/event', async (req, res, next) => {
    try {
      res.json(await peer.postEvent(req.body || {}))
    } catch (err) { next(err) }
  })

  app.post('/api/status', async (req, res, next) => {
    try { res.json(await peer.setStatus(req.body.status)) } catch (err) { next(err) }
  })

  app.post('/api/attach', upload.single('file'), async (req, res, next) => {
    try {
      const attachment = await peer.attachFile(req.file.path, req.file.originalname)
      fs.rm(req.file.path, { force: true }, () => {})
      res.json(attachment)
    } catch (err) { next(err) }
  })

  app.get('/api/attachment', async (req, res, next) => {
    try {
      const data = await peer.getAttachment({ driveKey: req.query.driveKey, attachmentPath: req.query.path })
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(req.query.name || req.query.path)}"`)
      res.end(data)
    } catch (err) { next(err) }
  })

  app.post('/api/export', (req, res) => {
    const snap = peer.snapshot()
    const md = renderReport(snap)
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="pearops-incident-report.md"')
    res.end(md)
  })

  app.use((err, req, res, next) => {
    console.error(err)
    res.status(500).json({ error: err.message })
  })

  const server = app.listen(port, () => {
    const url = `http://localhost:${port}`
    console.log(`PearOps ${name} listening at ${url}`)
    console.log(`Storage: ${storage}`)
    if (openBrowser) import('open').then(m => m.default(url)).catch(() => {})
  })

  process.on('SIGINT', async () => {
    server.close()
    await peer.close()
    process.exit(0)
  })

  if (process.argv.includes('--create')) {
    const title = arg('title', 'Checkout API outage')
    const severity = arg('severity', 'SEV2')
    const snap = await peer.createRoom({ title, severity, status: 'investigating' })
    console.log(`Room key: ${snap.roomKey}`)
    qrcode.generate(snap.roomKey, { small: true })
  }

  const joinKey = arg('join', null)
  if (joinKey) {
    const snap = await peer.joinRoom({ roomKey: joinKey })
    console.log(`Joined ${snap.roomKey}`)
  }
}

function renderReport (snap) {
  const m = snap.metadata || {}
  const lines = [
    `# Incident report: ${m.title || 'Untitled incident'}`,
    '',
    `- Severity: ${m.severity || 'unknown'}`,
    `- Status: ${m.status || 'unknown'}`,
    `- Created: ${m.createdAt || 'unknown'}`,
    `- Room: \`${snap.roomKey || ''}\``,
    '',
    '## Timeline',
    ''
  ]
  for (const e of snap.timeline) {
    lines.push(`- **${e.timestamp}** [${e.eventType}] ${e.author}: ${e.message}`)
    if (e.attachment) lines.push(`  - Attachment: ${e.attachment.name} (${e.attachment.size} bytes)`)
  }
  lines.push('', '## Notes', '', 'Generated locally by PearOps. No central backend was used.')
  return lines.join('\n')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
