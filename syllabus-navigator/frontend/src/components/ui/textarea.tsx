import * as React from 'react'

import { cn } from '@/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex min-h-16 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-xs transition-colors outline-none',
        'placeholder:text-muted-foreground/50 field-sizing-content',
        'focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/30',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
