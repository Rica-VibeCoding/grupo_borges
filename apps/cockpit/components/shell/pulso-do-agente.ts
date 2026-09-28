/**
 * A régua do PULSO — a faixa do topo da gaveta (ordem do Rica, 28/09, no
 * lugar de Permissões e Resume).
 *
 * Responde à pergunta que o Destravar sozinho não respondia: o agente travou
 * ou só está trabalhando calado? Duas fontes, cada uma cobrindo o que a outra
 * não enxerga:
 *
 * - `ultimo_evento` (do `/pulso`) diz há quanto tempo nada sai do JSONL dele;
 * - o turno vivo (`lib/turno-vivo.ts`) diz se ele DEVIA estar produzindo.
 *
 * Silêncio sem turno é descanso. Silêncio COM turno aberto é o travamento —
 * mas só depois de `SEM_SINAL_S`: um build ou um `sleep` longo emite zero
 * evento e não pode acender alarme no primeiro minuto.
 *
 * Módulo neutro, sem React, testado em `pulso-do-agente.test.ts`.
 */

/** Evento há menos que isto = está trabalhando agora. */
export const ATIVO_S = 90;

/** Turno aberto e nada saindo há isto = sem sinal. */
export const SEM_SINAL_S = 5 * 60;

export type TomDoPulso = 'ativo' | 'parado' | 'sem-sinal';

export type LeituraDoPulso = {
  tom: TomDoPulso;
  frase: string;
  /** "há 14 min" — vazio quando a frase já diz o tempo ou não há tempo a dizer. */
  ha: string;
};

export function haQuanto(segundos: number): string {
  if (segundos < 60) return `há ${Math.max(0, Math.round(segundos))} s`;
  const min = Math.floor(segundos / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const dias = Math.floor(h / 24);
  return dias === 1 ? 'há 1 dia' : `há ${dias} dias`;
}

export function leiaPulso(entrada: {
  agora: number;
  ultimoEvento: number | null;
  turnoVivo: boolean;
}): LeituraDoPulso {
  const { agora, ultimoEvento, turnoVivo } = entrada;
  if (ultimoEvento === null) return { tom: 'parado', frase: 'Sem atividade registrada', ha: '' };

  const silencio = agora - ultimoEvento;
  if (silencio < ATIVO_S) return { tom: 'ativo', frase: 'Trabalhando', ha: 'agora' };
  if (turnoVivo && silencio >= SEM_SINAL_S) return { tom: 'sem-sinal', frase: 'Sem sinal', ha: haQuanto(silencio) };
  if (turnoVivo) return { tom: 'ativo', frase: 'Trabalhando calado', ha: haQuanto(silencio) };
  return { tom: 'parado', frase: 'Parado', ha: haQuanto(silencio) };
}

/** Altura de cada barra em fração do maior balde da própria janela. Zero fica
 *  zero — quem desenha decide o traço do chão. */
export function alturasDoPulso(baldes: number[]): number[] {
  const max = Math.max(0, ...baldes);
  if (max === 0) return baldes.map(() => 0);
  // Raiz, não linear: um minuto de 96 eventos achataria em traço os minutos
  // de 5, e a leitura aqui é "teve vida?", não "quanto".
  return baldes.map((n) => (n <= 0 ? 0 : Math.max(0.12, Math.sqrt(n / max))));
}
