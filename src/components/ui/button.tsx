"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // Focus-visible ring comes from the global :focus-visible rule; the offset is
  // set per-size so it never crowds adjacent controls.
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-semibold transition-[background-color,border-color,color,box-shadow] duration-150 outline-none disabled:pointer-events-none disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-card hover:bg-primary/88 active:bg-primary disabled:bg-border disabled:text-muted-foreground disabled:shadow-none",
        secondary:
          "border border-border bg-card text-foreground shadow-card hover:bg-subtle active:bg-subtle disabled:border-border disabled:bg-muted/60 disabled:text-muted-foreground disabled:shadow-none",
        destructive:
          "bg-destructive text-destructive-foreground shadow-card hover:bg-destructive/90 active:bg-destructive/95 disabled:bg-border disabled:text-muted-foreground disabled:shadow-none",
        ghost:
          "text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted disabled:text-muted-foreground/60 disabled:hover:bg-transparent",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 rounded-md px-2.5 text-[13px] [&_svg]:size-3.5",
        default: "h-9 px-3.5 text-sm [&_svg]:size-4",
        lg: "h-10 px-4 text-sm [&_svg]:size-4",
        icon: "size-9 [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  // Default to a non-submitting button: a bare <button> inside a <form> submits
  // it, which silently turned "Cancel edit" into a save. Opt in with type="submit".
  type = "button",
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { Button, buttonVariants };
