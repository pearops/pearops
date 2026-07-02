const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createKeetIdentity, identityStatus, proofToJSON } = require('../src/identity')

;(async () => {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'pearops-identity-'))
  const empty = await identityStatus(storage)
  assert.equal(empty.configured, false, 'fresh app starts without identity')

  const a = await createKeetIdentity(storage)
  const configured = await identityStatus(storage)
  assert.equal(configured.configured, true, 'identity status becomes configured')
  assert.equal(configured.identityPublicKey, a.identityPublicKey, 'status exposes identity public key')

  const restoredStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'pearops-identity-restore-'))
  const restored = await createKeetIdentity(restoredStorage, { mnemonic: a.mnemonic })
  assert.equal(restored.identityPublicKey, a.identityPublicKey, 'restore from mnemonic keeps account identity')

  const b = await createKeetIdentity(storage, { requireExisting: true })
  assert.equal(a.identityPublicKey, b.identityPublicKey, 'identity survives reload from mnemonic')
  const payload = { id: 'event-1', timestamp: new Date(0).toISOString(), eventType: 'update', message: 'hello', attachment: null, metadata: null }
  const proof = proofToJSON(a.sign(payload))
  assert.equal(a.verify(proof, payload, a.identityPublicKey), true, 'signed event verifies against Keet identity public key')
  assert.equal(a.verify(proof, { ...payload, message: 'tampered' }, a.identityPublicKey), false, 'tampered event fails verification')
  console.log(JSON.stringify({ ok: true, identityPublicKey: a.identityPublicKey.slice(0, 16) + '…', restored: true }))
})().catch(err => { console.error(err); process.exit(1) })
