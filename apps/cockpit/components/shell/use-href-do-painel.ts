'use client';

import { usePathname, useSearchParams } from 'next/navigation';

import { hrefDoPainel } from './href-do-painel';

export function useHrefDoPainel(href: string): string {
  const pathname = usePathname();
  const busca = useSearchParams();
  return hrefDoPainel(href, pathname, busca?.toString() ?? '');
}
