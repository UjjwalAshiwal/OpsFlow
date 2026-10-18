"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

// Deterministic initials avatar: same name always gets the same swatch, so a
// person is recognisable across the list, the detail panel, and the dashboard.
// Muted warm neutrals + forest: recognisable per person, never a rainbow.
const SWATCHES = [
  "bg-[#2f3a33]",
  "bg-[#3f7d5e]",
  "bg-[#5b6570]",
  "bg-[#7a6448]",
] as const;

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function Avatar({
  name,
  className,
  ...props
}: React.ComponentProps<"span"> & { name: string }) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 997;
  return (
    <span
      // Decorative by default: the person's name is always rendered as text
      // beside the avatar, so exposing it again would duplicate announcements.
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white select-none",
        SWATCHES[h % SWATCHES.length],
        className ?? "size-8 text-xs",
      )}
      {...props}
    >
      {initialsOf(name)}
    </span>
  );
}

export { Avatar };
