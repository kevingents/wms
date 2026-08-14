import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind-className helper: combineer condities + merge conflicterende classes. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
