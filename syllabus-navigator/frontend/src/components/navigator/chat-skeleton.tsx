import { cn } from "@/lib/utils"

export function ChatSkeleton() {
  return (
    <div className="flex h-full w-full flex-col gap-5 overflow-y-auto py-6">
      {/* AI Message Skeleton */}
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 h-7 w-7 shrink-0 rounded-full bg-muted-foreground/10 animate-pulse" />
        <div className="flex w-full max-w-[82%] flex-col gap-2 rounded-2xl rounded-tl-md border border-border/60 bg-transparent px-4 py-3.5">
          <div className="h-4 w-3/4 animate-pulse rounded bg-muted-foreground/10" />
          <div className="h-4 w-full animate-pulse rounded bg-muted-foreground/10" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-muted-foreground/10" />
        </div>
      </div>

      {/* User Message Skeleton */}
      <div className="flex justify-end">
        <div className="flex w-full max-w-[78%] flex-col gap-2 rounded-2xl rounded-br-md bg-primary/10 px-4 py-3.5">
          <div className="h-4 w-full animate-pulse rounded bg-primary/20" />
          <div className="h-4 w-4/5 animate-pulse rounded bg-primary/20" />
        </div>
      </div>

      {/* AI Message Skeleton */}
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 h-7 w-7 shrink-0 rounded-full bg-muted-foreground/10 animate-pulse" />
        <div className="flex w-full max-w-[82%] flex-col gap-2 rounded-2xl rounded-tl-md border border-border/60 bg-transparent px-4 py-3.5">
          <div className="h-4 w-full animate-pulse rounded bg-muted-foreground/10" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted-foreground/10" />
        </div>
      </div>
    </div>
  )
}
