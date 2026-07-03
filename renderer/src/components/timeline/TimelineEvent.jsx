import { Clock3 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

export function TimelineEvent ({ event }) {
  return <article className="event-card">
    <div className="event-dot"><Clock3 size={12}/></div>
    <div className="event-body">
      <div className="event-meta"><Badge tone="orange">{event.eventType}</Badge><span>{new Date(event.timestamp).toLocaleString()}</span><span>{event.author}</span>{event.identity?.verified && <Badge tone="green">verified Keet ID</Badge>}</div>
      <p>{event.message}</p>
    </div>
  </article>
}
