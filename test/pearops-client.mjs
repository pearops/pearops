import { test } from 'node:test'
import assert from 'node:assert'
import { createPearOpsClient } from '../renderer/src/lib/pearops-client.js'

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function createMockBridge (options = {}) {
  const listeners = new Map()
  let pendingStart = null

  return {
    onWorkerIPC (worker, handler) {
      if (!listeners.has(worker)) listeners.set(worker, [])
      listeners.get(worker).push(handler)
      return () => {
        const list = listeners.get(worker) || []
        const idx = list.indexOf(handler)
        if (idx >= 0) list.splice(idx, 1)
      }
    },

    writeWorkerIPC (worker, data) {
      const msg = JSON.parse(data)

      if (options.mode === 'direct') {
        return Promise.resolve(options.response)
      }

      if (options.mode === 'async') {
        setTimeout(() => {
          for (const handler of listeners.get(worker) || []) {
            handler(JSON.stringify({ type: 'response', id: msg.id, result: options.result }))
          }
        }, options.delay ?? 10)
        return Promise.resolve(undefined)
      }

      if (options.mode === 'async-error') {
        setTimeout(() => {
          for (const handler of listeners.get(worker) || []) {
            handler(JSON.stringify({ type: 'response', id: msg.id, error: options.error }))
          }
        }, options.delay ?? 10)
        return Promise.resolve(undefined)
      }

      // mode === 'none' or undefined: no response, tests timeout
      return Promise.resolve(undefined)
    },

    startWorker (worker) {
      if (pendingStart) return pendingStart
      pendingStart = options.startWorkerPromise || Promise.resolve(options.startState || null)
      return pendingStart
    },

    emit (worker, message) {
      const payload = typeof message === 'string' ? message : JSON.stringify(message)
      for (const handler of listeners.get(worker) || []) handler(payload)
    }
  }
}

await test('createPearOpsClient throws without bridge', () => {
  assert.throws(() => createPearOpsClient(), /requires a bridge/)
})

await test('direct response updates snapshot and notifies', async () => {
  const mockState = { incidents: [], identity: { configured: false }, settings: {} }
  const bridge = createMockBridge({ mode: 'direct', response: mockState })
  const client = createPearOpsClient({ bridge, worker: '/test' })

  const snapshots = []
  const unsubscribe = client.subscribe(() => {
    snapshots.push(client.getSnapshot())
  })

  await client.call('getState')

  assert.equal(client.isReady(), true)
  assert.deepEqual(client.getSnapshot().state, mockState)
  assert.equal(snapshots.length, 1)
  unsubscribe()
  client.destroy()
})

await test('async response via onWorkerIPC resolves pending call', async () => {
  const mockState = { incidents: [], identity: { configured: false }, settings: {} }
  const bridge = createMockBridge({
    mode: 'async',
    result: mockState,
    delay: 10
  })
  const client = createPearOpsClient({ bridge, worker: '/test' })

  const result = await client.call('getState')
  assert.deepEqual(result, mockState)
  assert.equal(client.isReady(), true)

  client.destroy()
})

await test('ready message sets ready flag and applies state', async () => {
  const mockState = { incidents: [], identity: { configured: false }, settings: {} }
  const bridge = createMockBridge({ startWorkerPromise: Promise.resolve(null) })
  const client = createPearOpsClient({ bridge, worker: '/test' })

  setTimeout(() => bridge.emit('/test', { type: 'ready', state: mockState }), 10)

  await sleep(50)
  assert.equal(client.isReady(), true)
  assert.deepEqual(client.getSnapshot().state, mockState)

  client.destroy()
})

await test('state message applies state and notifies', async () => {
  const mockState = { incidents: [], identity: { configured: false }, settings: {} }
  const bridge = createMockBridge({ startWorkerPromise: Promise.resolve(null) })
  const client = createPearOpsClient({ bridge, worker: '/test' })

  const snapshots = []
  client.subscribe(() => snapshots.push(client.getSnapshot()))

  bridge.emit('/test', { type: 'state', state: mockState })
  await sleep(10)

  assert.equal(client.isReady(), true)
  assert.deepEqual(client.getSnapshot().state, mockState)
  assert.equal(snapshots.length, 1)

  client.destroy()
})

await test('generatedMnemonic result does not apply snapshot', async () => {
  const mockState = { incidents: [], identity: { configured: false }, settings: {}, generatedMnemonic: 'test mnemonic' }
  const bridge = createMockBridge({ mode: 'direct', response: mockState })
  const client = createPearOpsClient({ bridge, worker: '/test' })

  await client.call('createIdentity')

  assert.equal(client.getSnapshot().state, null)
  client.destroy()
})

await test('timeout rejects pending call', async () => {
  const bridge = createMockBridge({ mode: 'none' })
  const client = createPearOpsClient({ bridge, worker: '/test', timeout: 50 })

  await assert.rejects(client.call('getState'), /RPC timeout/)
  client.destroy()
})

await test('direct error response rejects call', async () => {
  const bridge = createMockBridge({ mode: 'direct', response: { error: 'test error' } })
  const client = createPearOpsClient({ bridge, worker: '/test' })

  await assert.rejects(client.call('getState'), /test error/)
  client.destroy()
})

await test('async error response rejects call', async () => {
  const bridge = createMockBridge({ mode: 'async-error', error: 'async test error', delay: 10 })
  const client = createPearOpsClient({ bridge, worker: '/test' })

  await assert.rejects(client.call('getState'), /async test error/)
  client.destroy()
})

await test('destroy cleans up pending calls', async () => {
  const bridge = createMockBridge({ mode: 'none' })
  const client = createPearOpsClient({ bridge, worker: '/test' })

  const promise = client.call('getState')
  client.destroy()

  await assert.rejects(promise, /Client destroyed/)
})
