/**
 * A barrinha "Trocar para X? Sim / Não" acima do composer — a rede de
 * segurança de quando o "trocar mesmo?" do Claude Code aparece mesmo com o
 * cockpit respondendo sozinho (27/09). Lógica pura: quando mostrar, e o texto.
 */
import type { PerguntaMotor } from '@grupo_borges/cockpit-core/cockpit-types';

import { rotulaEsforco } from './motor.ts';

/** O destino do modelo já vem com nome de exibição ("Haiku 4.5"); o do
 *  esforço vem cru ("medium") e ganha o rótulo que o chip já usa. */
export function rotuloDoDestino(pergunta: Pick<PerguntaMotor, 'tipo' | 'destino'>): string {
  const destino = pergunta.destino.trim();
  if (pergunta.tipo === 'esforco') return rotulaEsforco(destino.toLowerCase()) ?? destino;
  return destino;
}

export function textoDaPergunta(pergunta: Pick<PerguntaMotor, 'tipo' | 'destino'>): string {
  const destino = rotuloDoDestino(pergunta);
  return pergunta.tipo === 'esforco' ? `Trocar o esforço para ${destino}?` : `Trocar para ${destino}?`;
}

export function chaveDaPergunta(pergunta: Pick<PerguntaMotor, 'tipo' | 'destino'> | null | undefined): string | null {
  return pergunta ? `${pergunta.tipo}:${pergunta.destino}` : null;
}

/** O que a barra sabe além da frota: a pergunta que ele JÁ respondeu (some na
 *  hora, sem esperar os 5 s da próxima leitura) e a que o back devolveu num
 *  409 `pergunta_mudou` (entra no lugar, antes de a frota a ver). */
export type MemoriaDaBarra = { respondida: string | null; substituta: PerguntaMotor | null };

export const MEMORIA_VAZIA: MemoriaDaBarra = { respondida: null, substituta: null };

export function perguntaVisivel(
  daFrota: PerguntaMotor | null | undefined,
  memoria: MemoriaDaBarra,
): PerguntaMotor | null {
  const pergunta = memoria.substituta ?? daFrota ?? null;
  if (!pergunta) return null;
  if (chaveDaPergunta(pergunta) === memoria.respondida) return null;
  return pergunta;
}

/** A frota trouxe uma leitura NOVA: ela é mais recente que a memória. A
 *  substituta cai (a frota já fala por si), e a "respondida" só sobrevive se a
 *  frota ainda mostra a mesma pergunta — a leitura pode ser anterior ao toque. */
export function aoMudarAFrota(memoria: MemoriaDaBarra, daFrota: PerguntaMotor | null | undefined): MemoriaDaBarra {
  const chave = chaveDaPergunta(daFrota);
  const respondida = chave !== null && chave === memoria.respondida ? memoria.respondida : null;
  if (respondida === memoria.respondida && memoria.substituta === null) return memoria;
  return { respondida, substituta: null };
}

/** O desfecho de um toque, lido do corpo do POST ou do 409. */
export function depoisDoToque(
  memoria: MemoriaDaBarra,
  tocada: PerguntaMotor,
  desfecho:
    | { tipo: 'resposta'; respondida: boolean }
    | { tipo: 'erro'; codigo: string | null; pergunta: PerguntaMotor | null },
): MemoriaDaBarra {
  if (desfecho.tipo === 'resposta') {
    // A tecla saiu mas a pergunta não saiu da tela: a barra fica, ele toca de novo.
    return desfecho.respondida ? { respondida: chaveDaPergunta(tocada), substituta: null } : memoria;
  }
  if (desfecho.codigo === 'sem_pergunta_motor') return { respondida: chaveDaPergunta(tocada), substituta: null };
  if (desfecho.codigo === 'pergunta_mudou' && desfecho.pergunta) {
    // Outra pergunta no lugar: a barra troca para ela, e o toque NÃO vale nela.
    return { respondida: null, substituta: desfecho.pergunta };
  }
  return memoria;
}
