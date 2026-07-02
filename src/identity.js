const fs = require('fs')
const path = require('path')
const Identity = require('keet-identity-key')
const crypto = require('hypercore-crypto')
const b4a = require('b4a')

async function createKeetIdentity (storage, opts = {}) {
  fs.mkdirSync(storage, { recursive: true })
  const mnemonicPath = path.join(storage, 'identity-mnemonic.txt')
  let mnemonic = opts.mnemonic || process.env.PEAROPS_IDENTITY_MNEMONIC
  if (!mnemonic) {
    mnemonic = await fs.promises.readFile(mnemonicPath, 'utf8').catch(err => {
      if (err.code !== 'ENOENT') throw err
      return null
    })
  }
  if (!mnemonic) mnemonic = Identity.generateMnemonic()
  await fs.promises.writeFile(mnemonicPath, mnemonic, { mode: 0o600 })

  const identity = await Identity.from({ mnemonic: mnemonic.trim() })
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

module.exports = { createKeetIdentity, proofToJSON }
