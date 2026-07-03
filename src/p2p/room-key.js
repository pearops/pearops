const crypto = require('crypto')
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

module.exports = { topicFromRoomKey, roomKeyFromTopic }
