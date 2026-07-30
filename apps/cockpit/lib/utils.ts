import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Requisito dos componentes vendorizados do shadcn (`components/ui/*`). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
