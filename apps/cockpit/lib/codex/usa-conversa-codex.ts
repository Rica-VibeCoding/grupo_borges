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

import { useEffect, useMemo, useRef, useState } from 'react';

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';

import { criaAdaptadorCodex, type CodexMessage } from './adapta-mensagens.ts';

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

  const mensagens = useMemo(
    () => (ativo ? adaptadorRef.current!.adapta(brutas) : VAZIO),
    [brutas, ativo],
  );

  return { mensagens, carregou, threadId };
}
