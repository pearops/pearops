import React from 'react'
import { Filter, MessageSquare, Settings, ShieldCheck, Users, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { STATUSES, EVENT_TYPES, statusTone } from '@/lib/constants'
import { short } from '@/lib/format'
import { IdentitySetup } from '@/components/identity/IdentitySetup'
import { IncidentModal } from '@/components/incidents/IncidentModal'
import { IncidentRow } from '@/components/incidents/IncidentRow'
import { EmptyIncident } from '@/components/incidents/EmptyIncident'
import { TimelineEvent } from '@/components/timeline/TimelineEvent'
import { SettingsPage } from '@/components/settings/SettingsPage'

const initialState = { incidents: [], active: null, settings: {}, identity: { configured: false } }

export function App ({ usePearOps: usePearOpsHook }) {
  const pearOps = usePearOpsHook()
  const state = pearOps.state || initialState
  const { ready, actions } = pearOps

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
      return await fn()
    } catch (err) {
      alert(err.message)
      return null
    } finally {
      setBusy(false)
    }
  }

  React.useEffect(() => {
    if (settings.defaultEventType && EVENT_TYPES.includes(settings.defaultEventType)) {
      setEventType(settings.defaultEventType)
    }
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
      if (Notification.permission === 'granted') {
        new Notification(activeMeta.title || 'PearOps incident update', { body: event?.message || 'New timeline event' })
      } else if (Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {})
      }
    }
    notificationRef.current = { roomKey, count: timeline.length }
  }, [active?.roomKey, active?.timeline?.length, settings.notifications])

  if (!ready) {
    return <div className="app-shell"><main className="onboarding-shell"><Card><CardContent>Starting Pear Runtime worker…</CardContent></Card></main></div>
  }

  if (!identity.configured) {
    return <div className="app-shell"><IdentitySetup busy={busy} run={run} actions={actions} identity={identity} /></div>
  }

  return <div className={`app-shell density-${settings.compact === false ? 'comfortable' : 'compact'} theme-${settings.theme || 'system'}`}>
    <header className="topbar">
      <div className="brand"><div className="mark">P</div><div><strong>PearOps</strong><span>Linux incident console</span></div></div>
      <div className="top-actions">
        <Badge tone={identity.configured ? 'green' : 'orange'}><ShieldCheck size={12}/> Keet identity {identity.configured ? short(identity.identityPublicKey) : 'not set up'}</Badge>
        <Badge><Users size={12}/> {active?.peers || 0} peers</Badge>
        <Button variant={page === 'incidents' ? 'default' : 'ghost'} size="sm" onClick={() => setPage('incidents')}>Incidents</Button>
        <Button variant={page === 'settings' ? 'default' : 'ghost'} size="sm" onClick={() => setPage('settings')}><Settings size={14}/> Settings</Button>
      </div>
    </header>

    <div className="workspace">
      {page === 'settings'
        ? <SettingsPage state={state} run={run} actions={actions} />
        : <>
          <aside className="incident-sidebar">
            <div className="sidebar-top">
              <div>
                <p className="eyebrow"><Filter size={12}/> Incidents</p>
                <h2>{state.incidents?.length || 0} joined</h2>
              </div>
            </div>
            <div className="filters">{STATUSES.map(s => <button key={s} className={filter === s ? 'active' : ''} onClick={() => setFilter(s)}>{s}</button>)}</div>
            <div className="incident-actions">
              <Button size="sm" onClick={() => setIncidentModal('create')}>Create incident</Button>
              <Button variant="outline" size="sm" onClick={() => setIncidentModal('join')}>Join room</Button>
            </div>
            <div className="incident-list">
              {incidents.map(incident => <IncidentRow key={incident.id} incident={incident} selected={incident.id === state.activeIncidentId} onSelect={() => run(() => actions.selectIncident(incident.id))} onRemove={(e) => { e.stopPropagation(); run(() => actions.removeIncident(incident.id)) }} />)}
              {!incidents.length && <div className="empty-state">No local incidents for this filter.</div>}
            </div>
          </aside>

          {incidentModal && <IncidentModal mode={incidentModal} busy={busy} run={run} actions={actions} settings={settings} onClose={() => setIncidentModal(null)} />}
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
                <div className="status-buttons">{STATUSES.slice(1).map(s => <Button key={s} variant={activeMeta.status === s ? 'default' : 'outline'} size="sm" onClick={() => run(() => actions.setStatus(s))}>{s}</Button>)}</div>
              </section>

              <section className="timeline">
                {(active.timeline || []).map(e => <TimelineEvent key={e.id} event={e} />)}
                {!(active.timeline || []).length && <div className="empty-state">No replicated events yet.</div>}
              </section>

              <form className="chatbar" onSubmit={e => { e.preventDefault(); if (!draft.trim()) return; run(() => actions.postEvent({ eventType, message: draft.trim() }).then(() => setDraft(''))) }}>
                <select value={eventType} onChange={e => setEventType(e.target.value)}>{EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select>
                <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Post update, investigation, mitigation, or decision…" />
                <Button disabled={busy || !draft.trim()}><MessageSquare size={14}/> Send</Button>
              </form>
            </>}
          </main>
        </>}
    </div>
  </div>
}
