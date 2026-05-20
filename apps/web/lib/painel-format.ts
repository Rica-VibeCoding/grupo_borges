export function formatCompactNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';

  const sign = n < 0 ? '-' : '';
  const value = Math.abs(n);

  if (value >= 1_000_000) {
    const compact = value / 1_000_000;
    return `${sign}${Number.isInteger(compact) ? compact.toFixed(0) : compact.toFixed(1)}M`;
  }

  if (value >= 1_000) {
    const compact = value / 1_000;
    return `${sign}${Number.isInteger(compact) ? compact.toFixed(0) : compact.toFixed(1)}k`;
  }

  return `${n}`;
}

export function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

export function formatRemainingShort(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0m';

  const safe = Math.max(0, Math.floor(seconds));
  const days = Math.floor(safe / 86_400);
  const hours = Math.floor((safe % 86_400) / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatElapsedShort(seconds: number): string {
  if (!Number.isFinite(seconds)) return 'há 0m';

  const safe = Math.max(0, Math.floor(seconds));
  const days = Math.floor(safe / 86_400);
  const hours = Math.floor((safe % 86_400) / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  const secs = safe % 60;

  if (days > 0) return hours > 0 ? `há ${days}d ${hours}h` : `há ${days}d`;
  if (hours > 0) return `há ${hours}h ${minutes}m`;
  if (minutes > 0) return `há ${minutes}m ${secs}s`;
  return `há ${secs}s`;
}

export function formatCwdShort(cwd: string): string {
  const parts = cwd.split('/').filter(Boolean);
  if (parts.length === 0) return cwd;
  return parts[parts.length - 1];
}
