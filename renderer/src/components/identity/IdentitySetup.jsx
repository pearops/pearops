import React from 'react'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function IdentitySetup ({ busy, run, actions, identity }) {
  const [mode, setMode] = React.useState('create')
  const [mnemonic, setMnemonic] = React.useState('')
  const [generated, setGenerated] = React.useState(null)
  const [identitySet, setIdentitySet] = React.useState(false)

  async function submit (event) {
    event.preventDefault()
    const result = await run(() =>
      mode === 'restore'
        ? actions.restoreIdentity(mnemonic.trim())
        : actions.createIdentity()
    )
    if (!result) return
    if (result.generatedMnemonic) {
      setGenerated(result.generatedMnemonic)
    } else {
      setIdentitySet(true)
    }
  }

  if (identitySet) {
    return <main className="onboarding-shell">
      <Card className="onboarding-card">
        <CardHeader><CardTitle><ShieldCheck size={16}/> Identity configured</CardTitle></CardHeader>
        <CardContent>
          <p className="onboarding-copy">Your Keet identity is now set up and ready to use.</p>
          <Button onClick={() => window.location.reload()}>Continue to PearOps</Button>
        </CardContent>
      </Card>
    </main>
  }

  if (generated) {
    return <main className="onboarding-shell">
      <Card className="onboarding-card">
        <CardHeader><CardTitle><KeyRound size={16}/> Save your recovery phrase</CardTitle></CardHeader>
        <CardContent>
          <p className="onboarding-copy">This is the only time PearOps will show the generated mnemonic. Store it somewhere safe before continuing.</p>
          <pre className="mnemonic-box">{generated}</pre>
          <Button onClick={() => setIdentitySet(true)}>I saved it, continue</Button>
        </CardContent>
      </Card>
    </main>
  }

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
