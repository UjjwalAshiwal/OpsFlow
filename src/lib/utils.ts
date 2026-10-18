import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Canonical shadcn class merge: later Tailwind utilities win over earlier ones. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}