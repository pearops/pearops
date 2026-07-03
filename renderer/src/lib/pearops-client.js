import { WORKER_SPECIFIER } from './constants.js'

function generateId () {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID()
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function decodeData (data) {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data)
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data)
  return data?.toString?.() ?? ''
}

function looksLikePearOpsState (value) {
  return value && Array.isArray(value.incidents) && value.identity && value.settings
}

function shouldApplyState (result) {
  return looksLikePearOpsState(result) && !result.generatedMnemonic
}

export function createPearOpsClient (options = {}) {
  const clientBridge = options.bridge || (globalThis.window?.bridge)
  const worker = options.worker || WORKER_SPECIFIER
  const timeout = options.timeout ?? 30000

  if (!clientBridge) {
    throw new Error('PearOps client requires a bridge (window.bridge or options.bridge)')
  }

  const pending = new Map()
  const subscribers = new Set()
  let snapshot = { state: null, ready: false, error: null }
  let started = false

  function setSnapshot (next) {
    snapshot = next
    for (const listener of subscribers) listener()
  }

  function applyState (state) {
    setSnapshot({
      state,
      ready: true,
      error: state?.identity?.error || null
    })
  }

  function subscribe (onStoreChange) {
    subscribers.add(onStoreChange)
    return () => subscribers.delete(onStoreChange)
  }

  function getSnapshot () {
    return snapshot
  }

  function finishPending (id, err, result) {
    const p = pending.get(id)
    if (!p || p.settled) return
    p.settled = true
    clearTimeout(p.timer)
    pending.delete(id)
    if (err) p.reject(err)
    else {
      if (shouldApplyState(result)) applyState(result)
      p.resolve(result)
    }
  }

  async function call (method, params = {}) {
    const id = generateId()
    const msg = { id, method, params }

    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        finishPending(id, new Error(`RPC timeout for ${method} (${timeout}ms)`))
      }, timeout)
      pending.set(id, { resolve, reject, timer, settled: false })
    })

    try {
      const response = await clientBridge.writeWorkerIPC(worker, JSON.stringify(msg))

      // Direct synchronous response (Electron in-process service)
      // Only undefined means "async response will come via onWorkerIPC"
      if (response !== undefined) {
        if (response?.error) {
          finishPending(id, new Error(response.error))
          return promise
        }

        const result = Object.prototype.hasOwnProperty.call(response || {}, 'result')
          ? response.result
          : response

        finishPending(id, null, result)
        return promise
      }

      // Async response via onWorkerIPC events
      return promise
    } catch (err) {
      finishPending(id, err)
      return promise
    }
  }

  const off = clientBridge.onWorkerIPC(worker, data => {
    const text = decodeData(data)
    let msg
    try { msg = JSON.parse(text) } catch { return }

    if (msg.type === 'ready' || msg.type === 'state') {
      applyState(msg.state)
    }

    if (msg.type === 'response') {
      if (msg.error) finishPending(msg.id, new Error(msg.error))
      else finishPending(msg.id, null, msg.result)
    }
  })

  function destroy () {
    off()
    for (const [, p] of pending) {
      if (p.timer) clearTimeout(p.timer)
      if (!p.settled) p.reject(new Error('Client destroyed'))
    }
    pending.clear()
    subscribers.clear()
  }

  if (!started) {
    started = true
    clientBridge.startWorker(worker)
      .then(state => {
        // Only apply initial state if we don't have state yet
        if (state?.incidents && !snapshot.state) applyState(state)
      })
      .catch(err => {
        console.error('Failed to start worker', err)
        if (!snapshot.state) setSnapshot({ state: null, ready: true, error: err.message })
      })
  }

  const actions = {
    async createIdentity () {
      return call('createIdentity')
    },
    async restoreIdentity (mnemonic) {
      return call('restoreIdentity', { mnemonic })
    },
    async exportIdentity () {
      return call('exportIdentity')
    },
    async createIncident (payload) {
      return call('createIncident', payload)
    },
    async joinIncident (payload) {
      return call('joinIncident', payload)
    },
    async selectIncident (id) {
      return call('selectIncident', { id })
    },
    async removeIncident (id) {
      return call('removeIncident', { id })
    },
    async postEvent (payload) {
      return call('postEvent', payload)
    },
    async setStatus (status) {
      return call('setStatus', { status })
    },
    async saveSettings (settings) {
      return call('saveSettings', settings)
    },
    async getState () {
      return call('getState')
    }
  }

  return {
    subscribe,
    getSnapshot,
    call,
    actions,
    destroy,
    isReady: () => snapshot.ready
  }
}

let singleton = null

export function getPearOpsClient (options) {
  if (!singleton) {
    singleton = createPearOpsClient(options)
  }
  return singleton
}

export function resetPearOpsClient () {
  if (singleton) {
    singleton.destroy()
    singleton = null
  }
}
