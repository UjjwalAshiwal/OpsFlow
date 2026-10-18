"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "flex min-h-20 w-full rounded-md border border-input bg-card px-3 py-2 text-sm leading-relaxed text-foreground shadow-card transition-colors",
        "placeholder:text-muted-foreground/70",
        "hover:border-border-strong",
        "focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25",
        "aria-invalid:border-destructive",
        "disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
