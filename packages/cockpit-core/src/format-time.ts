const TIME_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: 'America/Sao_Paulo',
});

const DATETIME_FORMATTER = new Intl.DateTimeFormat('sv-SE', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: 'America/Sao_Paulo',
});

export function formatClock(unixSec: number): string {
  return `${TIME_FORMATTER.format(new Date(unixSec * 1000))} -03:00`;
}

export function formatTimeMs(unixMs: number): string {
  return TIME_FORMATTER.format(new Date(unixMs));
}

export function formatDateTime(unixSec: number): string {
  return DATETIME_FORMATTER.format(new Date(unixSec * 1000)).replace(' ', ' ');
}
