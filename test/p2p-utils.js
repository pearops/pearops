const assert = require('assert')
const { topicFromRoomKey, roomKeyFromTopic } = require('../src/p2p/room-key')
const { parseBlindPeerKeys } = require('../src/p2p/blind-peers')

// parseBlindPeerKeys tests
assert.deepEqual(parseBlindPeerKeys(null), [], 'null returns empty array')
assert.deepEqual(parseBlindPeerKeys(''), [], 'empty string returns empty array')
assert.deepEqual(parseBlindPeerKeys('key1'), ['key1'], 'single key')
assert.deepEqual(parseBlindPeerKeys('key1,key2'), ['key1', 'key2'], 'comma-separated keys')
assert.deepEqual(parseBlindPeerKeys('  key1  ,  key2  '), ['key1', 'key2'], 'trims whitespace')
assert.deepEqual(parseBlindPeerKeys(['key1', 'key2']), ['key1', 'key2'], 'array passthrough')
assert.deepEqual(parseBlindPeerKeys(['key1,key2', 'key3']), ['key1', 'key2', 'key3'], 'nested array flattens')

// topicFromRoomKey tests
const topic1 = topicFromRoomKey('pearops:abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234')
assert.strictEqual(topic1.length, 32, 'hex room key produces 32-byte topic')

const topic2 = topicFromRoomKey('abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234')
assert.strictEqual(topic2.length, 32, 'raw hex produces 32-byte topic')

const topic3 = topicFromRoomKey('my-room-name')
assert.strictEqual(topic3.length, 32, 'string room key produces 32-byte topic (sha256)')

const topic4 = topicFromRoomKey(null)
assert.strictEqual(topic4.length, 32, 'null produces random 32-byte topic')

const topic5 = topicFromRoomKey(undefined)
assert.strictEqual(topic5.length, 32, 'undefined produces random 32-byte topic')

// roomKeyFromTopic tests
const hexKey = 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234'
const topic = Buffer.from(hexKey, 'hex')
const roomKey = roomKeyFromTopic(topic)
assert.strictEqual(roomKey, `pearops:${hexKey}`, 'roomKeyFromTopic adds pearops: prefix')

// Round-trip test
const originalRoomKey = 'pearops:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
const roundTripTopic = topicFromRoomKey(originalRoomKey)
const roundTripRoomKey = roomKeyFromTopic(roundTripTopic)
assert.strictEqual(roundTripRoomKey, originalRoomKey, 'round-trip preserves room key')

console.log(JSON.stringify({ ok: true, tests: 16 }))
