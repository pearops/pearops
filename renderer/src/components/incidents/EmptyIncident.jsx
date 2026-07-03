import { AlertCircle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

export function EmptyIncident () {
  return <Card className="empty-card"><CardContent><AlertCircle/> Create or join an incident to start a replicated timeline.</CardContent></Card>
}
