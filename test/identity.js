const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createKeetIdentity, proofToJSON } = require('../src/identity')

;(async () => {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'pearops-identity-'))
  const a = await createKeetIdentity(storage)
  const b = await createKeetIdentity(storage)
  assert.equal(a.identityPublicKey, b.identityPublicKey, 'identity survives reload from mnemonic')
  const payload = { id: 'event-1', timestamp: new Date(0).toISOString(), eventType: 'update', message: 'hello', attachment: null, metadata: null }
  const proof = proofToJSON(a.sign(payload))
  assert.equal(a.verify(proof, payload, a.identityPublicKey), true, 'signed event verifies against Keet identity public key')
  assert.equal(a.verify(proof, { ...payload, message: 'tampered' }, a.identityPublicKey), false, 'tampered event fails verification')
  console.log(JSON.stringify({ ok: true, identityPublicKey: a.identityPublicKey.slice(0, 16) + '…' }))
})().catch(err => { console.error(err); process.exit(1) })
