import React from 'react'
import { useSyncExternalStore } from 'react'
import { getPearOpsClient } from '../lib/pearops-client.js'

export function usePearOps () {
  const client = React.useMemo(() => getPearOpsClient(), [])

  const snapshot = useSyncExternalStore(
    client.subscribe,
    client.getSnapshot,
    client.getSnapshot
  )

  return {
    state: snapshot.state,
    ready: snapshot.ready,
    error: snapshot.error,
    actions: client.actions,
    call: client.call
  }
}

export function usePearOpsActions () {
  const client = React.useMemo(() => getPearOpsClient(), [])
  return client.actions
}
