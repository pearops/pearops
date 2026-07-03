import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { AlertCircle, Clock3, Copy, Filter, KeyRound, MessageSquare, Settings, ShieldCheck, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import './styles.css'

const worker = '/workers/main.js'
const statuses = ['all', 'investigating', 'identified', 'monitoring', 'resolved']
const eventTypes = ['update', 'investigation', 'mitigation', 'decision']
const severities = ['SEV-0', 'SEV-1', 'SEV-2', 'SEV-3']
const pending = new Map()

async function callWorker (method, params = {}) {
  const id = crypto.randomUUID()
  const msg = { id, method, params }
  const response = await window.bridge.writeWorkerIPC(worker, JSON.stringify(msg))
  if (response?.error) throw new Error(response.error)
  if (response?.result) return response.result
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
  })
}

function usePearOps () {
  const [state, setState] = React.useState({ incidents: [], active: null, settings: {}, identity: { configured: false } })
  const [ready, setReady] = React.useState(false)

  React.useEffect(() => {
    const off = window.bridge.onWorkerIPC(worker, data => {
      const text = data.toString()
      let msg
      try { msg = JSON.parse(text) } catch { return }
      if (msg.type === 'ready' || msg.type === 'state') {
        setReady(true)
        setState(msg.state)
      }
      if (msg.type === 'response') {
        const p = pending.get(msg.id)
        if (!p) return
        pending.delete(msg.id)
        if (msg.error) p.reject(new Error(msg.error))
        else p.resolve(msg.result)
      }
    })
    window.bridge.startWorker(worker)
      .then(state => { if (state?.incidents) { setState(state); setReady(true) } })
      .catch(err => { console.error(err); setReady(true) })
    return off
  }, [])

  return { state, setState, ready }
}

function App () {
  const { state, setState, ready } = usePearOps()
  const [filter, setFilter] = React.useState('all')
  const [page, setPage] = React.useState('incidents')
  const [incidentModal, setIncidentModal] = React.useState(null)
  const [draft, setDraft] = React.useState('')
  const [eventType, setEventType] = React.useState('update')
  const [busy, setBusy] = React.useState(false)
  const active = state.active
  const activeMeta = active?.metadata || {}
  const identity = state.identity || { configured: false }
  const settings = state.settings || {}
  const incidents = (state.incidents || []).filter(i => filter === 'all' || i.status === filter)

  async function run (fn) {
    setBusy(true)
    try {
      const next = await fn()
      if (next?.incidents && !next.generatedMnemonic) setState(next)
      return next
    } catch (err) {
      alert(err.message)
    } finally { setBusy(false) }
  }

  async function call (method, params = {}) {
    setBusy(true)
    try {
      const result = await callWorker(method, params)
      return result
    } catch (err) {
      alert(err.message)
      return null
    } finally { setBusy(false) }
  }

  React.useEffect(() => {
    if (settings.defaultEventType && eventTypes.includes(settings.defaultEventType)) setEventType(settings.defaultEventType)
  }, [settings.defaultEventType])

  const notificationRef = React.useRef({ roomKey: null, count: 0 })
  React.useEffect(() => {
    const roomKey = active?.roomKey || null
    const timeline = active?.timeline || []
    const previous = notificationRef.current
    if (roomKey !== previous.roomKey) {
      notificationRef.current = { roomKey, count: timeline.length }
      return
    }
    if (settings.notifications && timeline.length > previous.count && previous.count > 0 && 'Notification' in window) {
      const event = timeline[timeline.length - 1]
      if (Notification.permission === 'granted') new Notification(activeMeta.title || 'PearOps incident update', { body: event?.message || 'New timeline event' })
      else if (Notification.permission === 'default') Notification.requestPermission().catch(() => {})
    }
    notificationRef.current = { roomKey, count: timeline.length }
  }, [active?.roomKey, active?.timeline?.length, settings.notifications])

  return <div className={`app-shell density-${settings.compact === false ? 'comfortable' : 'compact'} theme-${settings.theme || 'system'}`}>
    <header className="topbar">
      <div className="brand"><div className="mark">P</div><div><strong>PearOps</strong><span>Linux incident console</span></div></div>
      <div className="top-actions">
        <Badge tone={identity.configured ? 'green' : 'orange'}><ShieldCheck size={12}/> Keet identity {identity.configured ? short(identity.identityPublicKey) : 'not set up'}</Badge>
        <Badge><Users size={12}/> {active?.peers || 0} peers</Badge>
        {identity.configured && <Button variant={page === 'incidents' ? 'default' : 'ghost'} size="sm" onClick={() => setPage('incidents')}>Incidents</Button>}
        {identity.configured && <Button variant={page === 'settings' ? 'default' : 'ghost'} size="sm" onClick={() => setPage('settings')}><Settings size={14}/> Settings</Button>}
      </div>
    </header>

    {!ready && <main className="onboarding-shell"><Card><CardContent>Starting Pear Runtime worker…</CardContent></Card></main>}
    {ready && !identity.configured && <IdentitySetup busy={busy} call={call} setState={setState} identity={identity}/>}
    {ready && identity.configured && page === 'settings' && <SettingsPage state={state} run={run} call={call} />}
    {ready && identity.configured && page === 'incidents' && <div className="workspace">
      <aside className="incident-sidebar">
        <div className="sidebar-top">
          <div>
            <p className="eyebrow"><Filter size={12}/> Incidents</p>
            <h2>{state.incidents?.length || 0} joined</h2>
          </div>
        </div>
        <div className="filters">{statuses.map(s => <button key={s} className={filter === s ? 'active' : ''} onClick={() => setFilter(s)}>{s}</button>)}</div>
        <div className="incident-actions">
          <Button size="sm" onClick={() => setIncidentModal('create')}>Create incident</Button>
          <Button variant="outline" size="sm" onClick={() => setIncidentModal('join')}>Join room</Button>
        </div>
        <div className="incident-list">
          {incidents.map(incident => <IncidentRow key={incident.id} incident={incident} selected={incident.id === state.activeIncidentId} onSelect={() => run(() => callWorker('selectIncident', { id: incident.id }))} onRemove={(e) => { e.stopPropagation(); run(() => callWorker('removeIncident', { id: incident.id })) }}/>) }
          {!incidents.length && <div className="empty-state">No local incidents for this filter.</div>}
        </div>
      </aside>

      {incidentModal && <IncidentModal mode={incidentModal} busy={busy} run={run} settings={settings} onClose={() => setIncidentModal(null)} />}
      <main className="timeline-pane">
        {!active?.roomKey && <EmptyIncident />} 
        {active?.roomKey && <>
          <section className="incident-header">
            <div>
              <p className="eyebrow">Room <button className="copy" onClick={() => navigator.clipboard.writeText(active.roomKey)}><Copy size={12}/> {short(active.roomKey, 22)}</button></p>
              <h1>{activeMeta.title || 'Joined incident'}</h1>
              <div className="badges">
                <Badge tone="orange">{activeMeta.severity || 'SEV2'}</Badge>
                <Badge tone={statusTone(activeMeta.status)}>{activeMeta.status || 'investigating'}</Badge>
                <Badge>{active.timeline?.length || 0} events</Badge>
              </div>
            </div>
            <div className="status-buttons">{statuses.slice(1).map(s => <Button key={s} variant={activeMeta.status === s ? 'default' : 'outline'} size="sm" onClick={() => run(() => callWorker('setStatus', { status: s }))}>{s}</Button>)}</div>
          </section>

          <section className="timeline">
            {(active.timeline || []).map(e => <TimelineEvent key={e.id} event={e}/>) }
            {!(active.timeline || []).length && <div className="empty-state">No replicated events yet.</div>}
          </section>

          <form className="chatbar" onSubmit={e => { e.preventDefault(); if (!draft.trim()) return; run(() => callWorker('postEvent', { eventType, message: draft.trim() }).then(r => { setDraft(''); return r })) }}>
            <select value={eventType} onChange={e => setEventType(e.target.value)}>{eventTypes.map(t => <option key={t} value={t}>{t}</option>)}</select>
            <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Post update, investigation, mitigation, or decision…" />
            <Button disabled={busy || !draft.trim()}><MessageSquare size={14}/> Send</Button>
          </form>
        </>}
      </main>
    </div>}
  </div>
}

function IdentitySetup ({ busy, call, setState, identity }) {
  const [mode, setMode] = React.useState('create')
  const [mnemonic, setMnemonic] = React.useState('')
  const [generated, setGenerated] = React.useState(null)
  const [nextState, setNextState] = React.useState(null)

  async function submit (event) {
    event.preventDefault()
    const result = mode === 'restore'
      ? await call('restoreIdentity', { mnemonic: mnemonic.trim() })
      : await call('createIdentity')
    if (!result) return
    if (result.generatedMnemonic) {
      setNextState({ ...result, generatedMnemonic: undefined })
      setGenerated(result.generatedMnemonic)
    } else setState(result)
  }

  if (generated) return <main className="onboarding-shell">
    <Card className="onboarding-card">
      <CardHeader><CardTitle><KeyRound size={16}/> Save your recovery phrase</CardTitle></CardHeader>
      <CardContent>
        <p className="onboarding-copy">This is the only time PearOps will show the generated mnemonic. Store it somewhere safe before continuing.</p>
        <pre className="mnemonic-box">{generated}</pre>
        <Button onClick={() => setState(nextState)}>I saved it, continue</Button>
      </CardContent>
    </Card>
  </main>

  return <main className="onboarding-shell">
    <Card className="onboarding-card">
      <CardHeader><CardTitle><KeyRound size={16}/> Set up your Keet identity</CardTitle></CardHeader>
      <CardContent>
        <p className="onboarding-copy">PearOps uses a portable Keet identity key to sign incident timeline events. Create a new account or restore an existing mnemonic.</p>
        {identity.error && <div className="identity-error">{identity.error}</div>}
        <div className="onboarding-tabs">
          <button className={mode === 'create' ? 'active' : ''} onClick={() => setMode('create')}>Create new</button>
          <button className={mode === 'restore' ? 'active' : ''} onClick={() => setMode('restore')}>Restore</button>
        </div>
        <form className="onboarding-form" onSubmit={submit}>
          {mode === 'restore' && <label>Mnemonic<textarea value={mnemonic} onChange={e => setMnemonic(e.target.value)} placeholder="Paste your previous Keet identity mnemonic…" rows={4}/></label>}
          <Button disabled={busy || (mode === 'restore' && !mnemonic.trim())}>{mode === 'create' ? 'Create identity' : 'Restore identity'}</Button>
        </form>
      </CardContent>
    </Card>
  </main>
}

function IncidentModal ({ mode, busy, run, settings, onClose }) {
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
    const result = await run(() => callWorker(isJoin ? 'joinIncident' : 'createIncident', payload))
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
          <label>Severity<select value={severity} onChange={e => setSeverity(e.target.value)}>{severities.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
          <label>Brief description<textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="What is happening? This will be posted as the first timeline message." rows={4}/></label>
        </>}
      <div className="modal-actions">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={busy || (isJoin && !roomKey.trim())}>{isJoin ? 'Join room' : 'Create incident'}</Button>
      </div>
    </form>
  </div>
}

function IncidentRow ({ incident, selected, onSelect, onRemove }) {
  return <div className={`incident-row ${selected ? 'selected' : ''}`} role="button" tabIndex={0} onClick={onSelect} onKeyDown={e => { if (e.key === 'Enter') onSelect() }}>
    <div className="row-main"><strong>{incident.title}</strong><span>{short(incident.roomKey, 18)}</span></div>
    <div className="row-meta"><Badge tone={statusTone(incident.status)}>{incident.status}</Badge><small>{incident.severity}</small><button className="remove-incident" title="Remove this incident from local app state" onClick={onRemove}>Remove</button></div>
  </div>
}

function TimelineEvent ({ event }) {
  return <article className="event-card">
    <div className="event-dot"><Clock3 size={12}/></div>
    <div className="event-body">
      <div className="event-meta"><Badge tone="orange">{event.eventType}</Badge><span>{new Date(event.timestamp).toLocaleString()}</span><span>{event.author}</span>{event.identity?.verified && <Badge tone="green">verified Keet ID</Badge>}</div>
      <p>{event.message}</p>
    </div>
  </article>
}

function SettingsPage ({ state, run, call }) {
  const settings = state.settings || {}
  const identity = state.identity || {}
  const app = state.app || {}
  const [form, setForm] = React.useState({
    displayName: settings.displayName || 'Responder',
    notifications: settings.notifications !== false,
    compact: settings.compact !== false,
    theme: settings.theme || 'system',
    defaultSeverity: settings.defaultSeverity || 'SEV-2',
    defaultEventType: settings.defaultEventType || 'update',
    discoveryFlushTimeout: settings.discoveryFlushTimeout || 250,
    blindPeers: settings.blindPeers || ''
  })
  const [exportedMnemonic, setExportedMnemonic] = React.useState(null)
  const [exportBusy, setExportBusy] = React.useState(false)

  React.useEffect(() => {
    setForm({
      displayName: settings.displayName || 'Responder',
      notifications: settings.notifications !== false,
      compact: settings.compact !== false,
      theme: settings.theme || 'system',
      defaultSeverity: settings.defaultSeverity || 'SEV-2',
      defaultEventType: settings.defaultEventType || 'update',
      discoveryFlushTimeout: settings.discoveryFlushTimeout || 250,
      blindPeers: settings.blindPeers || ''
    })
  }, [settings.displayName, settings.notifications, settings.compact, settings.theme, settings.defaultSeverity, settings.defaultEventType, settings.discoveryFlushTimeout, settings.blindPeers])

  function setField (key, value) { setForm(prev => ({ ...prev, [key]: value })) }

  function submit (event) {
    event.preventDefault()
    run(() => callWorker('saveSettings', {
      ...form,
      discoveryFlushTimeout: Number(form.discoveryFlushTimeout) || 250
    }))
  }

  async function handleExport () {
    setExportBusy(true)
    try {
      const result = await call('exportIdentity')
      if (result?.mnemonic) setExportedMnemonic(result.mnemonic)
    } finally {
      setExportBusy(false)
    }
  }

  return <main className="settings-page">
    <section className="settings-hero">
      <div>
        <p className="eyebrow"><Settings size={12}/> Settings</p>
        <h1>Application settings</h1>
        <p>Configure your local identity label, interface defaults, P2P behaviour, and notification preferences.</p>
      </div>
      <Badge tone="green">saved locally</Badge>
    </section>

    <form className="settings-grid" onSubmit={submit}>
      <Card>
        <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
        <CardContent className="settings-section">
          <label>Display name<input value={form.displayName} onChange={e => setField('displayName', e.target.value)} placeholder="Responder" /></label>
          <div className="setting-note">Used as the author name for new timeline events and new incident peers.</div>
          <div className="readonly-row"><span>Keet identity</span><code>{short(identity.identityPublicKey || 'not configured', 34)}</code></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Incident defaults</CardTitle></CardHeader>
        <CardContent className="settings-section two-col">
          <label>Default severity<select value={form.defaultSeverity} onChange={e => setField('defaultSeverity', e.target.value)}>{severities.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
          <label>Default event type<select value={form.defaultEventType} onChange={e => setField('defaultEventType', e.target.value)}>{eventTypes.map(t => <option key={t} value={t}>{t}</option>)}</select></label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Interface</CardTitle></CardHeader>
        <CardContent className="settings-section two-col">
          <label>Theme<select value={form.theme} onChange={e => setField('theme', e.target.value)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
          <label>Density<select value={form.compact ? 'compact' : 'comfortable'} onChange={e => setField('compact', e.target.value === 'compact')}><option value="compact">Compact</option><option value="comfortable">Comfortable</option></select></label>
          <label className="check-row"><input type="checkbox" checked={form.notifications} onChange={e => setField('notifications', e.target.checked)} /> Enable local notifications</label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle><KeyRound size={16}/> Identity recovery</CardTitle></CardHeader>
        <CardContent className="settings-section">
          <div className="readonly-row"><span>Identity public key</span><code>{short(identity.identityPublicKey || 'not configured', 24)}</code></div>
          <p className="setting-note">Export your recovery phrase to restore this PearOps identity on another device. Anyone with this phrase can use your identity.</p>
          {!exportedMnemonic
            ? <Button type="button" variant="outline" disabled={exportBusy} onClick={handleExport}><KeyRound size={14}/> Export recovery phrase</Button>
            : <>
                <pre className="mnemonic-box">{exportedMnemonic}</pre>
                <div className="settings-actions">
                  <Button type="button" variant="outline" onClick={() => navigator.clipboard?.writeText(exportedMnemonic)}><Copy size={14}/> Copy</Button>
                  <Button type="button" variant="ghost" onClick={() => setExportedMnemonic(null)}>Hide</Button>
                </div>
              </>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>P2P / advanced</CardTitle></CardHeader>
        <CardContent className="settings-section">
          <label>Discovery wait timeout<input type="number" min="50" max="2500" step="50" value={form.discoveryFlushTimeout} onChange={e => setField('discoveryFlushTimeout', e.target.value)} /></label>
          <div className="setting-note">Lower values make incident switching feel faster. Peers continue connecting after the UI opens the room.</div>
          <label>Blind peer keys<textarea value={form.blindPeers} onChange={e => setField('blindPeers', e.target.value)} placeholder="Optional comma-separated blind peer keys" rows={3}/></label>
          <div className="readonly-row"><span>Storage</span><code>{app.storage || 'unknown'}</code></div>
        </CardContent>
      </Card>

      <div className="settings-actions">
        <Button>Save settings</Button>
      </div>
    </form>
  </main>
}

function EmptyIncident () { return <Card className="empty-card"><CardContent><AlertCircle/> Create or join an incident to start a replicated timeline.</CardContent></Card> }
function short (v = '', n = 12) { return v.length > n ? `${v.slice(0, n)}…` : v }
function statusTone (s) { return s === 'resolved' ? 'green' : s === 'monitoring' ? 'blue' : s === 'identified' ? 'orange' : 'red' }

createRoot(document.getElementById('root')).render(<App />)
