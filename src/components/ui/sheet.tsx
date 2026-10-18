"use client";

import * as React from "react";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/icons";

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;

function SheetContent({
  className,
  side = "left",
  children,
  onOpenAutoFocus,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & { side?: "left" | "right" }) {
  const closeRef = React.useRef<HTMLButtonElement>(null);
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-sidebar/45 animate-fade-in" />
      <SheetPrimitive.Content
        // Start keyboard users at the top of the drawer, not the last control.
        onOpenAutoFocus={(e) => {
          onOpenAutoFocus?.(e);
          if (!e.defaultPrevented) {
            e.preventDefault();
            closeRef.current?.focus();
          }
        }}
        className={cn(
          "fixed inset-y-0 z-50 flex w-72 max-w-[85vw] flex-col bg-sidebar shadow-pop transition-transform duration-200 ease-out",
          side === "left" ? "left-0 border-r border-sidebar-border" : "right-0 border-l border-sidebar-border",
          className,
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close
          ref={closeRef}
          className="absolute top-4 right-4 rounded-md p-1.5 text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          aria-label="Close navigation"
        >
          <Icon name="x" className="size-4" />
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1", className)} {...props} />;
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title className={cn("text-sm font-bold text-sidebar-accent-foreground", className)} {...props} />;
}

function SheetDescription({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return <SheetPrimitive.Description className={cn("text-[13px] text-sidebar-muted", className)} {...props} />;
}

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetDescription };
