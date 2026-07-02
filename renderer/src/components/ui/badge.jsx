import { cn } from '@/lib/utils'
export function Badge ({ className, tone = 'default', ...props }) { return <span className={cn('ui-badge', `ui-badge-${tone}`, className)} {...props} /> }
