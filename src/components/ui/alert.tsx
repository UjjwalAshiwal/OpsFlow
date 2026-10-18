"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva("flex items-start gap-3 rounded-lg border px-3.5 py-3 text-sm", {
  variants: {
    variant: {
      info: "border-info/25 bg-info/5 text-foreground",
      warning: "border-warning/30 bg-warning/10 text-foreground",
      destructive: "border-destructive/25 bg-destructive/5 text-foreground",
      success: "border-success/25 bg-success/5 text-foreground",
    },
  },
  defaultVariants: { variant: "info" },
});

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

function AlertTitle({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-sm font-bold", className)} {...props} />;
}

function AlertDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-[13px] text-muted-foreground", className)} {...props} />;
}

export { Alert, AlertTitle, AlertDescription };
