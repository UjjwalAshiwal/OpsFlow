"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Native `<select>` on purpose. Every filter in this product uses "" to mean
 * "no filter", and on mobile the OS picker is strictly better than a custom
 * listbox; Radix Select forbids empty item values, so swapping it in would mean
 * sentinel values on ten call sites. Styled to match shadcn triggers.
 */
function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        className={cn(
          "h-9 w-full appearance-none rounded-md border border-input bg-card py-1 pr-8 pl-3 text-sm text-foreground shadow-card transition-colors",
          "hover:border-border-strong",
          "focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25",
          "disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}

export { Select };
