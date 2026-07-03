const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createKeetIdentity, identityStatus, exportMnemonic, restoreMnemonic, normalizeMnemonic, proofToJSON } = require('../src/identity')

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

  const exported = await exportMnemonic(storage)
  assert.equal(exported.mnemonic, a.mnemonic, 'export returns original mnemonic')
  assert.equal(exported.identityPublicKey, a.identityPublicKey, 'export returns matching identity public key')

  const normalized = normalizeMnemonic('  word1   word2  word3  ')
  assert.equal(normalized, 'word1 word2 word3', 'normalizeMnemonic trims and collapses whitespace')
  assert.throws(() => normalizeMnemonic(''), /Recovery phrase is required/, 'normalizeMnemonic rejects empty string')
  assert.throws(() => normalizeMnemonic('   '), /Recovery phrase is required/, 'normalizeMnemonic rejects whitespace-only')

  const doubleRestoreStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'pearops-identity-double-'))
  await restoreMnemonic(doubleRestoreStorage, a.mnemonic)
  await assert.rejects(
    () => restoreMnemonic(doubleRestoreStorage, a.mnemonic),
    /Identity is already configured/,
    'restore refuses overwrite when identity exists'
  )
  const overwritten = await restoreMnemonic(doubleRestoreStorage, a.mnemonic, { overwrite: true })
  assert.equal(overwritten.identityPublicKey, a.identityPublicKey, 'restore with overwrite replaces existing identity')

  console.log(JSON.stringify({ ok: true, identityPublicKey: a.identityPublicKey.slice(0, 16) + '…', exported: true, restored: true }))
})().catch(err => { console.error(err); process.exit(1) })
