export type ClipboardResult = 'modern' | 'fallback' | 'failed';

export type ClipboardAttempts = {
  writeText?: (text: string) => Promise<void>;
  fallbackCopy: (text: string) => boolean;
};

/**
 * O write moderno é invocado antes de qualquer await para preservar o gesto
 * transitório exigido pelo Safari iOS. O fallback só roda se ele não existir
 * ou rejeitar.
 */
export async function copyText(
  text: string,
  attempts: ClipboardAttempts,
): Promise<ClipboardResult> {
  if (attempts.writeText) {
    try {
      const write = attempts.writeText(text);
      await write;
      return 'modern';
    } catch {
      // Continua para o fallback síncrono.
    }
  }

  try {
    return attempts.fallbackCopy(text) ? 'fallback' : 'failed';
  } catch {
    return 'failed';
  }
}
