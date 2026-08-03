// compact-eta — a matemática da barra de progresso do `/compact`, pura.
//
// O Claude Code NÃO emite progresso intermediário durante o compact: entre o
// envio do `/compact` e a chegada do `isCompactSummary` não há sinal nenhum
// (verificado no JSONL em 02/08). Portanto a barra é uma ESTIMATIVA
// determinística, honesta sobre ser estimativa:
//
//   - o ETA inicial é 140 s (mediana de 63 compacts reais do histórico, 02/08);
//     depois de cada compact concluído, a duração real entra no histórico do
//     agente e o próximo ETA é a mediana das últimas 5.
//   - a barra enche até 90% ao longo do ETA e PARA lá. Nunca chega em 100% no
//     chute — 100% só existe quando o resumo chega de verdade.
//   - estourou o ETA sem resumo: fica nos 90% ("quase lá"). Estourou 6 minutos:
//     "sem retorno" — o composer destrava sozinho, porque o sinal se perdeu e
//     ninguém pode ficar preso esperando.
//
// Morada no core e não no app: a régua é testável sem React e o desenho
// (`barra-compact.tsx`) fica sendo só pixel.

/** ETA antes de qualquer medição — mediana dos 63 compacts medidos em 02/08
 *  (manuais 93–163 s; automáticos até 300 s). */
export const ETA_COMPACT_PADRAO_MS = 140_000;

/** Quantas durações reais entram na mediana do próximo ETA. */
export const JANELA_DURACOES_COMPACT = 5;

/** Teto da estimativa. A barra nunca afirma 100% antes do resumo chegar —
 *  mentir "acabou" é o defeito que esta peça existe para matar. */
export const TETO_PROGRESSO_COMPACT = 0.9;

/** Escape hatch: passou disto sem o `isCompactSummary`, o sinal se perdeu.
 *  6 min cobre o pior automático medido (300 s) com o dobro de margem. */
export const ESCAPE_COMPACT_MS = 6 * 60_000;

/** Fases da espera, derivadas do tempo decorrido — não é estado guardado, é
 *  conta em cima do relógio. */
export type FaseEsperaCompact = 'enchendo' | 'quase-la' | 'sem-retorno';

/** Mediana comum. Arrays de 1–5 entradas aqui, mas a função não depende
 *  disso. Cópia ordenada, nunca muta a entrada. */
export function mediana(valores: readonly number[]): number {
  if (valores.length === 0) return 0;
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 1
    ? ordenados[meio]
    : (ordenados[meio - 1] + ordenados[meio]) / 2;
}

/** O ETA do próximo compact: mediana das últimas `JANELA_DURACOES_COMPACT`
 *  durações reais; sem histórico, o padrão medido. Duração inválida (≤ 0 ou
 *  não finita) não entra na conta — um relógio quebrado não pode derrubar o
 *  ETA para zero e fazer a barra nascer "quase lá". */
export function etaDoCompact(duracoesReais: readonly number[]): number {
  const validas = duracoesReais.filter((d) => Number.isFinite(d) && d > 0);
  if (validas.length === 0) return ETA_COMPACT_PADRAO_MS;
  return mediana(validas.slice(-JANELA_DURACOES_COMPACT));
}

/** Progresso determinístico 0..TETO: linear no ETA, travado no teto. Tempo
 *  negativo (relógio à frente) não existe — é zero. */
export function progressoDoCompact(decorridoMs: number, etaMs: number): number {
  if (etaMs <= 0) return TETO_PROGRESSO_COMPACT;
  const bruto = Math.max(0, decorridoMs) / etaMs;
  return Math.min(TETO_PROGRESSO_COMPACT, bruto * TETO_PROGRESSO_COMPACT);
}

/** A fase da espera. Dentro do ETA a barra ainda enche (valor conhecido, a
 *  ARIA pode anunciar); passou dele o valor é DESCONHECIDO — a spec do
 *  progressbar manda omitir `aria-valuenow`, e é este retorno que manda o
 *  componente omitir. */
export function faseDaEsperaCompact(decorridoMs: number, etaMs: number): FaseEsperaCompact {
  const decorrido = Math.max(0, decorridoMs);
  if (decorrido >= ESCAPE_COMPACT_MS) return 'sem-retorno';
  if (decorrido > etaMs) return 'quase-la';
  return 'enchendo';
}

/** Cronômetro ao lado do rótulo: "42s" até um minuto, "1m12s" depois (segundos
 *  com dois dígitos, como relógio). Em mono + tabular na tela, então a largura
 *  é estável e o número não dança. */
export function rotuloCronometroCompact(decorridoMs: number): string {
  const segundos = Math.max(0, Math.floor(decorridoMs / 1000));
  if (segundos < 60) return `${segundos}s`;
  const minutos = Math.floor(segundos / 60);
  const resto = String(segundos % 60).padStart(2, '0');
  return `${minutos}m${resto}s`;
}

/** "222k → 13k tokens" do cartão: milhar abreviado, vírgula decimal pt-BR
 *  quando sobra fração (13.500 → "13,5k"; 222.000 → "222k"). Abaixo de mil,
 *  o número cru. */
export function formataTokens(n: number): string {
  const inteiro = Math.round(n);
  if (inteiro < 1000) return String(inteiro);
  const k = inteiro / 1000;
  const arredondado = Math.round(k * 10) / 10;
  return `${String(arredondado).replace('.', ',')}k`;
}
