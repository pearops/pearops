import { Badge } from '@/components/ui/badge'
import { statusTone } from '@/lib/constants'
import { short } from '@/lib/format'

export function IncidentRow ({ incident, selected, onSelect, onRemove }) {
  return <div className={`incident-row ${selected ? 'selected' : ''}`} role="button" tabIndex={0} onClick={onSelect} onKeyDown={e => { if (e.key === 'Enter') onSelect() }}>
    <div className="row-main"><strong>{incident.title}</strong><span>{short(incident.roomKey, 18)}</span></div>
    <div className="row-meta"><Badge tone={statusTone(incident.status)}>{incident.status}</Badge><small>{incident.severity}</small><button className="remove-incident" title="Remove this incident from local app state" onClick={onRemove}>Remove</button></div>
  </div>
}
