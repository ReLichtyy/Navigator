import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap shrink-0 [&>svg]:size-3 transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-secondary text-secondary-foreground",
        accent: "border-accent/25 bg-accent/10 text-accent",
        new: "border-transparent bg-accent-bright text-[#06140d] font-bold tracking-[0.08em]",
        outline: "border-border text-foreground",
        ok: "border-transparent bg-green-500/10 text-green-500",
        error: "border-transparent bg-red-500/10 text-red-500",
        warn: "border-transparent bg-amber-500/10 text-amber-500",
        pending: "border-transparent bg-accent/10 text-accent animate-pulse",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"
  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
