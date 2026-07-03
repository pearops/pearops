import React from 'react'
import { Button } from '@/components/ui/button'
import { SEVERITIES } from '@/lib/constants'

export function IncidentModal ({ mode, busy, run, actions, settings, onClose }) {
  const [roomKey, setRoomKey] = React.useState('')
  const [title, setTitle] = React.useState('Checkout API outage')
  const [severity, setSeverity] = React.useState(settings?.defaultSeverity || 'SEV-2')
  const [description, setDescription] = React.useState('')
  const isJoin = mode === 'join'

  async function submit (event) {
    event.preventDefault()
    const payload = isJoin
      ? { roomKey: roomKey.trim() }
      : {
          title: title.trim() || 'New incident',
          severity,
          description: description.trim(),
          status: 'investigating'
        }
    const result = await run(() => (isJoin ? actions.joinIncident(payload) : actions.createIncident(payload)))
    if (result) onClose()
  }

  return <div className="modal-backdrop" onClick={onClose}>
    <form className="incident-modal" onSubmit={submit} onClick={e => e.stopPropagation()}>
      <div className="modal-header">
        <div>
          <p className="eyebrow">{isJoin ? 'Join room' : 'Create incident'}</p>
          <h3>{isJoin ? 'Join existing PearOps room' : 'Create new PearOps incident'}</h3>
        </div>
        <button type="button" className="modal-close" onClick={onClose}>Close</button>
      </div>
      {isJoin
        ? <label>Room key<input value={roomKey} onChange={e => setRoomKey(e.target.value)} placeholder="pearops: room key" autoFocus /></label>
        : <>
          <label>Title<input value={title} onChange={e => setTitle(e.target.value)} placeholder="Incident title" autoFocus /></label>
          <label>Severity<select value={severity} onChange={e => setSeverity(e.target.value)}>{SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
          <label>Brief description<textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="What is happening? This will be posted as the first timeline message." rows={4}/></label>
        </>}
      <div className="modal-actions">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={busy || (isJoin && !roomKey.trim())}>{isJoin ? 'Join room' : 'Create incident'}</Button>
      </div>
    </form>
  </div>
}
