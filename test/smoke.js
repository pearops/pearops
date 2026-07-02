const fs = require('fs')
const path = require('path')
const os = require('os')
const assert = require('assert')
const { PearOpsPeer } = require('../src/peer')
const { createKeetIdentity } = require('../src/identity')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function waitFor (label, fn, timeout = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const value = await fn()
    if (value) return value
    await sleep(500)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function main () {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pearops-smoke-'))
  const identityA = path.join(root, 'identity-a')
  const identityB = path.join(root, 'identity-b')
  const account = await createKeetIdentity(identityA)
  await createKeetIdentity(identityB, { mnemonic: account.mnemonic })
  const a = new PearOpsPeer({ name: 'Peer-A', storage: path.join(root, 'a'), identityStorage: identityA })
  const b = new PearOpsPeer({ name: 'Peer-B', storage: path.join(root, 'b'), identityStorage: identityB })
  try {
    const room = await a.createRoom({ title: 'Smoke test incident', severity: 'SEV2', status: 'investigating' })
    await b.joinRoom({ roomKey: room.roomKey })
    await waitFor('peers to connect', () => a.peerCount() > 0 && b.peerCount() > 0)

    await a.postEvent({ eventType: 'investigation', message: 'A sees elevated 500s' })
    await waitFor('B receives A event', () => b.timeline().find(e => e.message.includes('elevated 500s')))

    await b.postEvent({ eventType: 'mitigation', message: 'B rolled back worker release' })
    await waitFor('A receives B event', () => a.timeline().find(e => e.message.includes('rolled back')))

    const evidence = path.join(root, 'evidence.txt')
    fs.writeFileSync(evidence, 'log excerpt: checkout failed with ECONNRESET\n')
    const attachment = await a.attachFile(evidence)
    await waitFor('B receives attachment timeline event', () => b.timeline().find(e => e.attachment && e.attachment.name === 'evidence.txt'))
    const downloaded = await waitFor('B downloads attachment', async () => {
      try { return await b.getAttachment({ driveKey: attachment.driveKey, attachmentPath: attachment.path }) } catch { return null }
    })
    assert.strictEqual(downloaded.toString(), fs.readFileSync(evidence, 'utf8'))

    console.log(JSON.stringify({ ok: true, roomKey: room.roomKey, aEvents: a.timeline().length, bEvents: b.timeline().length, attachment: attachment.name }, null, 2))
  } finally {
    await Promise.allSettled([a.close(), b.close()])
    fs.rmSync(root, { recursive: true, force: true })
  }
}

main().catch(err => { console.error(err); process.exit(1) })
