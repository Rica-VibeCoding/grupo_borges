'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function StaleClientGuard() {
  const router = useRouter();

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        router.refresh();
      }
    };

    const refreshWhenRestored = (event: PageTransitionEvent) => {
      if (event.persisted) {
        router.refresh();
      }
    };

    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('pageshow', refreshWhenRestored);

    return () => {
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('pageshow', refreshWhenRestored);
    };
  }, [router]);

  return null;
}
