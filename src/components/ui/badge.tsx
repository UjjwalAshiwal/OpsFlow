"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * One surface + text pair per operational state, reused identically by badges,
 * tables, the workflow stepper, and the activity timeline. Every badge carries a
 * text label, so state is never communicated by colour alone.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-md px-2 py-[3px] text-[11px] leading-4 font-semibold tracking-[0.01em] whitespace-nowrap",
  {
    variants: {
      variant: {
        open: "bg-status-open-surface text-status-open",
        progress: "bg-status-progress-surface text-status-progress",
        review: "bg-status-review-surface text-status-review",
        done: "bg-status-done-surface text-status-done",
        cancelled: "bg-status-cancelled-surface text-status-cancelled",
        outline: "border border-border bg-card text-muted-foreground",
        sidebar: "bg-sidebar-accent text-sidebar-accent-foreground",
      },
    },
    defaultVariants: { variant: "open" },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** Status dot, sized to sit optically centred inside a badge. */
function Dot({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", className)} />;
}

export { Badge, Dot, badgeVariants };
