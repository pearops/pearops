import { cn } from '@/lib/utils'
export function Card ({ className, ...props }) { return <div className={cn('ui-card', className)} {...props} /> }
export function CardHeader ({ className, ...props }) { return <div className={cn('ui-card-header', className)} {...props} /> }
export function CardTitle ({ className, ...props }) { return <h3 className={cn('ui-card-title', className)} {...props} /> }
export function CardContent ({ className, ...props }) { return <div className={cn('ui-card-content', className)} {...props} /> }
