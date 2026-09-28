'use client';

// A BARRINHA "Trocar para X? Sim / Não" — a rede de segurança da troca de
// modelo/esforço (27/09). O chip espera o agente ficar ocioso e o back responde
// "sim" sozinho; se o "trocar mesmo?" do Claude Code aparecer assim mesmo, é
// aqui que o Rica responde, em vez de ficar preso num modal que nenhuma tecla
// do cockpit alcançava. Mora logo acima da caixa, como a do `/compact`.

import { useEffect, useState } from 'react';

import { AgentInputError, ErroDaTrocaDeMotor, fetchAgentPainel, postAgentConfirmacaoMotor } from '@grupo_borges/cockpit-core/api';
import type { PerguntaMotor } from '@grupo_borges/cockpit-core/cockpit-types';

import { usaFrota } from './frota-provider';
import {
  MEMORIA_VAZIA,
  aoMudarAFrota,
  chaveDaPergunta,
  depoisDoToque,
  perguntaVisivel,
  textoDaPergunta,
  type MemoriaDaBarra,
} from './pergunta-motor.ts';
import { publicarPainel } from './sincronizacao-painel';

export function BarraPerguntaMotor({ agentSlug }: { agentSlug: string }) {
  const { agents } = usaFrota();
  const daFrota = agents.find((a) => a.slug === agentSlug)?.pergunta_motor ?? null;
  const chaveDaFrota = chaveDaPergunta(daFrota);
  const [memoria, setMemoria] = useState<MemoriaDaBarra>(MEMORIA_VAZIA);
  const [respondendo, setRespondendo] = useState(false);

  // Leitura nova da frota é mais recente que a memória do último toque.
  useEffect(() => {
    setMemoria((atual) => aoMudarAFrota(atual, daFrota));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a chave É a pergunta
  }, [chaveDaFrota]);
  useEffect(() => setMemoria(MEMORIA_VAZIA), [agentSlug]);

  const pergunta = perguntaVisivel(daFrota, memoria);
  if (!pergunta) return null;

  async function responder(alvo: PerguntaMotor, resposta: 'sim' | 'nao') {
    setRespondendo(true);
    try {
      const corpo = await postAgentConfirmacaoMotor(agentSlug, resposta, alvo);
      setMemoria((atual) => depoisDoToque(atual, alvo, { tipo: 'resposta', respondida: corpo.respondida }));
      // O chip lê o painel, não a frota: sem isto ele seguia no modelo antigo
      // depois do "Sim" até a próxima releitura dele.
      if (corpo.respondida) void fetchAgentPainel(agentSlug).then(publicarPainel).catch(() => undefined);
    } catch (erro) {
      // 409 `sem_pergunta_motor` some sem erro; `pergunta_mudou` troca a barra
      // para a pergunta nova sem aplicar o toque. Rede caída: a barra fica.
      const codigo = erro instanceof AgentInputError ? erro.detail : null;
      const nova = erro instanceof ErroDaTrocaDeMotor ? erro.pergunta : null;
      setMemoria((atual) => depoisDoToque(atual, alvo, { tipo: 'erro', codigo, pergunta: nova }));
    } finally {
      setRespondendo(false);
    }
  }

  const estiloDoBotao = (principal: boolean) => ({
    minHeight: 'var(--ck-touch-min)',
    minWidth: 'var(--ck-touch-min)',
    padding: '0 var(--ck-space-3)',
    borderRadius: 'var(--ck-radius-chip)',
    borderColor: principal ? 'var(--ck-edge-functional)' : 'transparent',
    color: principal ? 'var(--ck-text-primary)' : 'var(--ck-text-secondary)',
    fontSize: 'var(--ck-text-sm)',
    fontWeight: principal ? 500 : 400,
  });

  return (
    <div
      role="group"
      aria-label="Pergunta do agente sobre a troca"
      className="ck-sobre-material mx-auto flex w-full items-center justify-between"
      style={{
        maxWidth: 'var(--ck-w-composer)',
        padding: '0 var(--ck-space-2)',
        gap: 'var(--ck-space-2)',
      }}
    >
      <span
        role="status"
        aria-live="polite"
        className="min-w-0 truncate"
        style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-state-attention)' }}
      >
        {textoDaPergunta(pergunta)}
      </span>
      <span className="flex shrink-0 items-center" style={{ gap: 'var(--ck-space-1)' }}>
        <button
          type="button"
          disabled={respondendo}
          onClick={() => void responder(pergunta, 'sim')}
          className="ck-veil border"
          style={estiloDoBotao(true)}
        >
          Sim
        </button>
        <button
          type="button"
          disabled={respondendo}
          onClick={() => void responder(pergunta, 'nao')}
          className="ck-veil border"
          style={estiloDoBotao(false)}
        >
          Não
        </button>
      </span>
    </div>
  );
}
