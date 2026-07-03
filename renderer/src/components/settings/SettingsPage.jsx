import React from 'react'
import { Settings, KeyRound, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SEVERITIES, EVENT_TYPES } from '@/lib/constants'
import { short } from '@/lib/format'

export function SettingsPage ({ state, run, actions }) {
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
    run(() => actions.saveSettings({
      ...form,
      discoveryFlushTimeout: Number(form.discoveryFlushTimeout) || 250
    }))
  }

  async function handleExport () {
    setExportBusy(true)
    try {
      const result = await actions.exportIdentity()
      if (result?.mnemonic) setExportedMnemonic(result.mnemonic)
    } catch (err) {
      alert(err.message)
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
          <label>Default severity<select value={form.defaultSeverity} onChange={e => setField('defaultSeverity', e.target.value)}>{SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
          <label>Default event type<select value={form.defaultEventType} onChange={e => setField('defaultEventType', e.target.value)}>{EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></label>
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
