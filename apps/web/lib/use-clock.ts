'use client';

import { useEffect, useState } from 'react';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatNow(): string {
  const d = new Date();
  return `T+ ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function useClock(): string {
  const [stamp, setStamp] = useState('T+ --:--:--');

  useEffect(() => {
    setStamp(formatNow());
    const id = setInterval(() => setStamp(formatNow()), 1000);
    return () => clearInterval(id);
  }, []);

  return stamp;
}
