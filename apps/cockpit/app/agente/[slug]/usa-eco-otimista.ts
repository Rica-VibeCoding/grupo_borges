'use client';

// O eco otimista do feed: as bolhas do Rica (texto e anexo) antes de o log
// saber que elas existem. Saiu de `feed-da-conversa.tsx` (02/10) — o hook que
// assina os dois stores de pendência, e as fábricas de bolha que ele usa.

import { useEffect, useMemo, useSyncExternalStore } from 'react';

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';
import {
  assinaPendentes,
  lePendentes,
  reconciliaPendentes,
  type EcoPendente,
} from '@/lib/eco-pendente.ts';
import {
  assinaAnexosPendentes,
  leAnexosPendentes,
  reconciliaAnexosPendentes,
  type AnexoPendente,
} from '@/lib/anexo-pendente.ts';
import { textosDoUsuario } from '@/lib/textos-do-usuario.ts';

/** As `messages` do stream com as bolhas otimistas penduradas no fim, na
 *  ordem do gesto. Sem pendência nenhuma, devolve o MESMO array que recebeu. */
export function usaEcoOtimista(agentSlug: string, messages: MessagePayload[]) {
  // O ECO OTIMISTA, agora TAMBÉM aqui. Este ramo passou meses sem ele apoiado
  // numa frase que estava escrita como fato em dois arquivos — *"no Claude Code
  // o eco volta pelo stream em milissegundos"*. Medi em 15/08 no `:3008`, com o
  // agente OCIOSO: o campo esvazia em 0,1 s e a bolha só aparece **18,9 s**
  // depois. São 18,8 segundos de tela muda entre o toque e qualquer sinal de
  // que a mensagem existe — o que o Rica descreve como *"o composer engole a
  // mensagem"*. A régua da NN/g põe o limite de atenção em 10 s
  // (nngroup.com/articles/response-times-3-important-limits): entregávamos
  // quase o dobro disso de nada.
  //
  // A pendência também segura o alarme de entrega, e isso é conserto, não
  // efeito colateral: `PRAZO_ECO_MS` são 12 s, calibrados em 30/07 sobre uma
  // amostra cujo pior caso era 1,434 s. Com o eco real em 18,9 s o prazo
  // estourava ANTES da confirmação chegar, e toda mensagem para agente ocioso
  // terminava em âmbar dizendo "não consegui confirmar se entrou — pode
  // duplicar". Falso, e é o que pausa a fila e pendura a mensagem seguinte
  // pedindo "enviar mesmo assim". Enquanto a pendência existe o prazo
  // reexamina (`usa-envio.ts:297`); quando ela reconcilia, a máquina recebe o
  // recibo por `assinaEntrega`. O teto de 3 min continua valendo para o caso
  // em que a mensagem realmente não entrou.
  const assina = useMemo(() => (fn: () => void) => assinaPendentes(agentSlug, fn), [agentSlug]);
  const le = useMemo(() => () => lePendentes(agentSlug), [agentSlug]);
  const pendentes = useSyncExternalStore(assina, le, () => SEM_PENDENCIA);
  // O ANEXO tem store próprio (`anexo-pendente.ts`): ele não segura o alarme
  // do texto, e casa pelo nome do arquivo no servidor, não pelo texto.
  const assinaAnexos = useMemo(() => (fn: () => void) => assinaAnexosPendentes(agentSlug, fn), [agentSlug]);
  const leAnexos = useMemo(() => () => leAnexosPendentes(agentSlug), [agentSlug]);
  const anexosPendentes = useSyncExternalStore(assinaAnexos, leAnexos, () => SEM_ANEXO);
  useEffect(() => {
    const textos = textosDoUsuario(messages);
    reconciliaPendentes(agentSlug, textos);
    reconciliaAnexosPendentes(agentSlug, textos);
  }, [agentSlug, messages, anexosPendentes]);

  const comEco = useMemo(() => {
    if (pendentes.length === 0 && anexosPendentes.length === 0) return messages;
    const base = messages.length;
    // Na ordem do gesto: texto e anexo mandados em sequência aparecem na
    // sequência em que o Rica os mandou.
    const otimistas = [
      ...pendentes.map((p) => ({ emMs: p.emMs, cria: (n: number) => criaBolhaOtimista(p, n) })),
      ...anexosPendentes.map((p) => ({ emMs: p.emMs, cria: (n: number) => criaBolhaAnexoOtimista(p, n) })),
    ].sort((a, b) => a.emMs - b.emMs);
    return [...messages, ...otimistas.map((o, i) => o.cria(base + i))];
  }, [messages, pendentes, anexosPendentes]);

  return comEco;
}

const SEM_PENDENCIA: readonly EcoPendente[] = Object.freeze([]);
const SEM_ANEXO: readonly AnexoPendente[] = Object.freeze([]);

/** A bolha do anexo antes do eco. O texto é só a legenda (ou o nome do
 *  arquivo, para o item nunca nascer vazio); quem desenha a foto ou o vídeo é
 *  `bolha-anexo-otimista.tsx`, pelo `uuid`. */
function criaBolhaAnexoOtimista(pendente: AnexoPendente, ordinal: number): MessagePayload {
  const texto = pendente.legenda || pendente.nome;
  return criaBolhaOtimista({ id: pendente.id, texto, emMs: pendente.emMs, prazoMs: 0 }, ordinal);
}

/** A bolha do Rica antes de o log saber que ela existe. Mesma forma que o
 *  stream produz — daqui pra baixo nenhuma peça do feed distingue as duas.
 *  Gêmea da bolha otimista do composer; as duas
 *  são pequenas e vivem em ramos que não se importam, e unificá-las custaria
 *  um módulo a mais para poupar dez linhas. */
function criaBolhaOtimista(pendente: EcoPendente, ordinal: number): MessagePayload {
  return {
    id: ordinal,
    kind: 'user',
    uuid: `cc-otimista-${pendente.id}`,
    parent_uuid: null,
    session_id: null,
    is_sidechain: false,
    user_type: 'external',
    timestamp: new Date(pendente.emMs).toISOString(),
    created_at: pendente.emMs,
    message: { role: 'user', content: pendente.texto },
  };
}
