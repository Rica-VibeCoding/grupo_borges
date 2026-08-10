'use client';

/**
 * A CONVERSA DA TARA, por polling.
 *
 * POR QUE NÃO É SSE COMO O RESTO DO CHAT. `GET /api/agents/{slug}/messages/stream`
 * é agnóstico ao executor mas o replay dele filtra kinds `jsonl:*`
 * (`apps/api/db/store.py`, `_JSONL_MESSAGE_KINDS`); os eventos da Tara nascem
 * `codex.*`/`tara.exec.*` e não casam. O stream abre, responde `total: 0` e não
 * dá erro nenhum — é exatamente por isso que o chat dela mostrava "Sem conversa
 * ainda." com o composer funcionando do lado.
 *
 * O SSE que a Tara TEM (`/api/stream` → `useFrotaAoVivo`) carrega atividade, não
 * texto: o payload de conversa é redigido antes de virar `task_events`
 * (`apps/api/routers/codex_events.py`, `redact_payload`). O texto das falas só
 * existe no rollout, indexado no `~/.codex/state_5.sqlite`, e só sai por
 * `GET /codex/messages`. Logo: polling. Emitir as mensagens do rollout como
 * evento de chat seria contrato novo no back — não é esta rodada.
 *
 * A CADÊNCIA. 3 s é o mesmo tique do `usaDelegacoes`, que já pinta "Tara
 * trabalhando" neste feed. Turno de Codex leva minutos; ler o sqlite é barato e
 * a resposta é curta.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';

import { criaAdaptadorCodex, type CodexMessage } from './adapta-mensagens.ts';
import {
  assinaPendentes,
  lePendentes,
  reconciliaPendentes,
  type EcoPendente,
} from './eco-pendente.ts';

const POLL_MS = 3_000;

/** Mesmo teto do feed do CC (`HISTORICO_PADRAO`), pela mesma ordem do Rica em
 *  09/08: *"pode mandar 100 mensagens, no máximo"*. */
const HISTORICO_PADRAO = 100;

type RespostaCodex = {
  thread_id: string | null;
  messages?: CodexMessage[];
};

export type ConversaCodex = {
  mensagens: MessagePayload[];
  /** `false` até a primeira resposta chegar. Quem desenha o vazio precisa
   *  distinguir "ainda não perguntei" de "perguntei e não tem nada" — sem isso
   *  o "Sem conversa ainda." pisca em toda montagem, que é a mentira que esta
   *  tela toda veio consertar. */
  carregou: boolean;
  threadId: string | null;
};

const VAZIO: MessagePayload[] = [];

export function usaConversaCodex(slug: string, ativo: boolean): ConversaCodex {
  const [brutas, setBrutas] = useState<CodexMessage[]>([]);
  const [carregou, setCarregou] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);

  // Uma instância por slug: a memória de identidade do adaptador não pode
  // atravessar agentes, senão a conversa de um herda objeto do outro.
  const adaptadorRef = useRef<{ slug: string; adapta: ReturnType<typeof criaAdaptadorCodex> } | null>(
    null,
  );
  if (adaptadorRef.current === null || adaptadorRef.current.slug !== slug) {
    adaptadorRef.current = { slug, adapta: criaAdaptadorCodex() };
  }

  useEffect(() => {
    if (!ativo) return;

    // A guarda de sequência é a `ignore` que a doc do React recomenda
    // explicitamente para efeito que busca dado (react.dev,
    // "Synchronizing with Effects" — *"if the effect re-runs, the previous one
    // is ignored"*). `AbortController` sozinho não resolve: a resposta pode já
    // estar decodificando quando o slug troca.
    let ignorar = false;

    const busca = async () => {
      try {
        const res = await fetch(
          `/api/agents/${encodeURIComponent(slug)}/codex/messages?limit=${HISTORICO_PADRAO}`,
          { cache: 'no-store' },
        );
        if (!res.ok || ignorar) return;
        const corpo = (await res.json()) as RespostaCodex;
        if (ignorar) return;
        setBrutas(Array.isArray(corpo.messages) ? corpo.messages : []);
        setThreadId(corpo.thread_id ?? null);
      } catch {
        // Rede fora ou API caída: segura o último estado bom, igual
        // `usaDelegacoes`. Piscar o feed é pior que atrasar 3 s.
      } finally {
        if (!ignorar) setCarregou(true);
      }
    };

    void busca();
    const timer = setInterval(() => void busca(), POLL_MS);
    return () => {
      ignorar = true;
      clearInterval(timer);
    };
  }, [slug, ativo]);

  const doRollout = useMemo(
    () => (ativo ? adaptadorRef.current!.adapta(brutas) : VAZIO),
    [brutas, ativo],
  );

  // O ECO OTIMISTA. Entre o toque do Rica e o texto existir no rollout passam
  // 12 s (medido em 10/08) — é o `codex exec` subindo. Sem isto o feed fica
  // mudo nesse intervalo e parece que a mensagem se perdeu.
  const assina = useMemo(() => (fn: () => void) => assinaPendentes(slug, fn), [slug]);
  const le = useMemo(() => () => lePendentes(slug), [slug]);
  // No servidor não há pendência nenhuma: a bolha otimista nasce de um gesto do
  // browser. Devolver a MESMA lista vazia evita erro de hidratação.
  const pendentes = useSyncExternalStore(assina, le, () => SEM_PENDENCIA);

  // Chegou pelo rollout? A pendência cumpriu o papel e sai. Efeito, não cálculo
  // no render: isto ESCREVE no store, e escrever durante o render é o que a
  // doc do React proíbe.
  useEffect(() => {
    reconciliaPendentes(
      slug,
      doRollout.flatMap((m) =>
        m.kind === 'user' && typeof m.message?.content === 'string' ? [m.message.content] : [],
      ),
    );
  }, [slug, doRollout]);

  const mensagens = useMemo(() => {
    if (pendentes.length === 0) return doRollout;
    const base = doRollout.length;
    return [
      ...doRollout,
      ...pendentes.map((p, i) => criaBolhaOtimista(p, base + i)),
    ];
  }, [doRollout, pendentes]);

  return { mensagens, carregou, threadId };
}

const SEM_PENDENCIA: readonly EcoPendente[] = Object.freeze([]);

/** A bolha do Rica antes de o Codex saber que ela existe. Mesma forma que o
 *  adaptador produz — daqui pra baixo nenhuma peça do feed distingue as duas. */
function criaBolhaOtimista(pendente: EcoPendente, ordinal: number): MessagePayload {
  return {
    id: ordinal,
    kind: 'user',
    uuid: `codex-otimista-${pendente.id}`,
    parent_uuid: null,
    session_id: null,
    is_sidechain: false,
    user_type: 'external',
    timestamp: new Date(pendente.emMs).toISOString(),
    created_at: pendente.emMs,
    message: { role: 'user', content: pendente.texto },
  };
}
