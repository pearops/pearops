import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { AlertCircle, Clock3, Copy, Filter, KeyRound, MessageSquare, Plus, Settings, ShieldCheck, Trash2, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import './styles.css'

const worker = '/workers/main.js'
const statuses = ['all', 'investigating', 'identified', 'monitoring', 'resolved']
const eventTypes = ['update', 'investigation', 'mitigation', 'decision']
const pending = new Map()

function callWorker (method, params = {}) {
  const id = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    window.bridge.writeWorkerIPC(worker, JSON.stringify({ id, method, params }))
  })
}

function usePearOps () {
  const [state, setState] = React.useState({ incidents: [], active: null, settings: {}, identity: { configured: false } })
  const [ready, setReady] = React.useState(false)

  React.useEffect(() => {
    window.bridge.startWorker(worker)
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
    callWorker('getState').then(setState).catch(() => {})
    return off
  }, [])

  return { state, setState, ready }
}

function App () {
  const { state, setState, ready } = usePearOps()
  const [filter, setFilter] = React.useState('all')
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const [eventType, setEventType] = React.useState('update')
  const [busy, setBusy] = React.useState(false)
  const active = state.active
  const activeMeta = active?.metadata || {}
  const identity = state.identity || { configured: false }
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

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="mark">P</div><div><strong>PearOps</strong><span>Linux incident console</span></div></div>
      <div className="top-actions">
        <Badge tone={identity.configured ? 'green' : 'orange'}><ShieldCheck size={12}/> Keet identity {identity.configured ? short(identity.identityPublicKey) : 'not set up'}</Badge>
        <Badge><Users size={12}/> {active?.peers || 0} peers</Badge>
        {identity.configured && <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(v => !v)}><Settings size={14}/> Settings</Button>}
      </div>
    </header>

    {!ready && <main className="onboarding-shell"><Card><CardContent>Starting Pear Runtime worker…</CardContent></Card></main>}
    {ready && !identity.configured && <Onboarding busy={busy} run={run} setState={setState} identity={identity}/>} 
    {ready && identity.configured && <div className="workspace">
      <aside className="incident-sidebar">
        <div className="sidebar-top">
          <div>
            <p className="eyebrow"><Filter size={12}/> Incidents</p>
            <h2>{state.incidents?.length || 0} joined</h2>
          </div>
          <Button size="sm" onClick={() => run(() => callWorker('createIncident', { title: 'New incident', severity: 'SEV2', status: 'investigating' }))}><Plus size={14}/></Button>
        </div>
        <div className="filters">{statuses.map(s => <button key={s} className={filter === s ? 'active' : ''} onClick={() => setFilter(s)}>{s}</button>)}</div>
        <div className="quick-join"><JoinCreate run={run}/></div>
        <div className="incident-list">
          {incidents.map(incident => <IncidentRow key={incident.id} incident={incident} selected={incident.id === state.activeIncidentId} onSelect={() => run(() => callWorker('selectIncident', { id: incident.id }))} onRemove={(e) => { e.stopPropagation(); run(() => callWorker('removeIncident', { id: incident.id })) }}/>) }
          {!incidents.length && <div className="empty-state">No local incidents for this filter.</div>}
        </div>
      </aside>

      <main className="timeline-pane">
        {settingsOpen && <SettingsPanel settings={state.settings} run={run}/>} 
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

function Onboarding ({ busy, run, setState, identity }) {
  const [mode, setMode] = React.useState('create')
  const [mnemonic, setMnemonic] = React.useState('')
  const [generated, setGenerated] = React.useState(null)
  const [nextState, setNextState] = React.useState(null)

  async function submit (event) {
    event.preventDefault()
    const result = await run(() => callWorker('setupIdentity', mode === 'restore' ? { mnemonic: mnemonic.trim() } : {}))
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

function JoinCreate ({ run }) {
  const [roomKey, setRoomKey] = React.useState('')
  const [title, setTitle] = React.useState('Checkout API outage')
  return <div className="join-card">
    <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Incident title" />
    <div className="join-row"><Button size="sm" onClick={() => run(() => callWorker('createIncident', { title, severity: 'SEV2', status: 'investigating' }))}>Create</Button></div>
    <input value={roomKey} onChange={e => setRoomKey(e.target.value)} placeholder="pearops: room key" />
    <Button variant="outline" size="sm" disabled={!roomKey.trim()} onClick={() => run(() => callWorker('joinIncident', { roomKey: roomKey.trim() }))}>Join incident</Button>
  </div>
}

function IncidentRow ({ incident, selected, onSelect, onRemove }) {
  return <button className={`incident-row ${selected ? 'selected' : ''}`} onClick={onSelect}>
    <div className="row-main"><strong>{incident.title}</strong><span>{short(incident.roomKey, 18)}</span></div>
    <div className="row-meta"><Badge tone={statusTone(incident.status)}>{incident.status}</Badge><small>{incident.severity}</small><Trash2 size={13} onClick={onRemove}/></div>
  </button>
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

function SettingsPanel ({ settings, run }) {
  const [displayName, setDisplayName] = React.useState(settings?.displayName || 'Responder')
  return <Card className="settings-panel"><CardHeader><CardTitle>Settings</CardTitle></CardHeader><CardContent>
    <label>Display name<input value={displayName} onChange={e => setDisplayName(e.target.value)} /></label>
    <div className="placeholder-grid"><div>Notifications placeholder</div><div>Blind peer placeholder</div><div>Theme placeholder</div></div>
    <Button size="sm" onClick={() => run(() => callWorker('saveSettings', { displayName }))}>Save settings</Button>
  </CardContent></Card>
}

function EmptyIncident () { return <Card className="empty-card"><CardContent><AlertCircle/> Create or join an incident to start a replicated timeline.</CardContent></Card> }
function short (v = '', n = 12) { return v.length > n ? `${v.slice(0, n)}…` : v }
function statusTone (s) { return s === 'resolved' ? 'green' : s === 'monitoring' ? 'blue' : s === 'identified' ? 'orange' : 'red' }

createRoot(document.getElementById('root')).render(<App />)
