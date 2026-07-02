const fs = require('fs')
const path = require('path')
const Identity = require('keet-identity-key')
const crypto = require('hypercore-crypto')
const b4a = require('b4a')

function identityMnemonicPath (storage) {
  return path.join(storage, 'identity-mnemonic.txt')
}

async function readMnemonic (storage) {
  const mnemonicPath = identityMnemonicPath(storage)
  return fs.promises.readFile(mnemonicPath, 'utf8').then(s => s.trim()).catch(err => {
    if (err.code !== 'ENOENT') throw err
    return null
  })
}

async function identityStatus (storage) {
  const mnemonic = await readMnemonic(storage)
  if (!mnemonic) return { configured: false, mnemonicPath: identityMnemonicPath(storage) }
  const identity = await Identity.from({ mnemonic })
  return {
    configured: true,
    mnemonicPath: identityMnemonicPath(storage),
    identityPublicKey: b4a.toString(identity.identityPublicKey, 'hex')
  }
}

async function createKeetIdentity (storage, opts = {}) {
  fs.mkdirSync(storage, { recursive: true })
  const mnemonicPath = identityMnemonicPath(storage)
  let mnemonic = opts.mnemonic || process.env.PEAROPS_IDENTITY_MNEMONIC
  if (!mnemonic) mnemonic = await readMnemonic(storage)
  if (!mnemonic && opts.requireExisting) throw new Error('Keet identity is not configured')
  if (!mnemonic) mnemonic = Identity.generateMnemonic()
  mnemonic = mnemonic.trim().replace(/\s+/g, ' ')
  await fs.promises.writeFile(mnemonicPath, mnemonic, { mode: 0o600 })

  const identity = await Identity.from({ mnemonic })
  const deviceKeyPair = crypto.keyPair()
  const deviceProof = await identity.bootstrap(deviceKeyPair.publicKey)
  const identityPublicKey = b4a.toString(identity.identityPublicKey, 'hex')
  const devicePublicKey = b4a.toString(deviceKeyPair.publicKey, 'hex')

  return {
    identity,
    deviceKeyPair,
    deviceProof,
    identityPublicKey,
    devicePublicKey,
    mnemonic,
    mnemonicPath,
    sign (payload) {
      const buffer = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload))
      return Identity.attestData(buffer, deviceKeyPair, deviceProof)
    },
    verify (proof, payload, expectedIdentity = identity.identityPublicKey) {
      const buffer = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload))
      const key = typeof expectedIdentity === 'string' ? Buffer.from(expectedIdentity, 'hex') : expectedIdentity
      const proofBuffer = typeof proof === 'string' ? Buffer.from(proof, 'hex') : proof
      return !!Identity.verify(proofBuffer, buffer, { expectedIdentity: key })
    }
  }
}

function proofToJSON (proof) {
  if (!proof) return null
  return Buffer.from(proof).toString('hex')
}

module.exports = { createKeetIdentity, identityStatus, readMnemonic, proofToJSON }
