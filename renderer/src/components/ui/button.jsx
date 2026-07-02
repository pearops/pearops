import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cn } from '@/lib/utils'

export function Button ({ className, variant = 'default', size = 'default', asChild = false, ...props }) {
  const Comp = asChild ? Slot : 'button'
  return <Comp className={cn('ui-button', `ui-button-${variant}`, `ui-button-${size}`, className)} {...props} />
}
