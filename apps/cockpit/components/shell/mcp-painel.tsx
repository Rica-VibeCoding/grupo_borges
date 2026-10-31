'use client';

/**
 * PainelMcp — a tela de MCPs (tarefa `8764d666`, 09/08).
 *
 * O back já existe inteiro (`apps/api/routers/agents.py:1681`, JP-25): quatro
 * origens (plugin/mcp.json/remote/user_scope) com `enabled` resolvido e
 * credencial redigida, PATCH que sabe onde cada origem se desliga, reload que
 * manda `/reload-plugins` pro tmux. Este arquivo só consome — a régua pura
 * (filtro, busca, ordenação) mora em
 * `mcp-servidores.ts`, testada; aqui fica estado, rede e pixel, mesma divisão
 * de `bloco-de-acoes.tsx`.
 *
 * A REFERÊNCIA do Rica (`docs/referencias-ui/mcps-referencia-lista-fundo-branco-09-08.jpg`)
 * é a MODELAGEM, não os pixels: campo de busca no topo, uma linha por
 * servidor (ícone à esquerda, nome, ação à direita), densidade baixa, sem
 * cartão nem borda por item. É tela do ChatGPT em tema claro, mas o cockpit é
 * `color-scheme: dark` por contrato. Desde 31/10 (Rica: "não está na cultura
 * do código") ela veste as peças da gaveta, como o painel de Conversas: busca
 * em pílula, `Cartao` > `Bloco` com uma linha por servidor e o `Interruptor`
 * com a palavra do estado — sem superfície própria.
 *
 * Rodapé: a referência tem um chevron pra "conectar" mais servidores. Não
 * existe endpoint pra isso — inventar o botão seria UI que não faz nada. O
 * que a tela TEM depois de um toggle é a exigência de reload, que já existia
 * no v1 (`apps/web/components/mcp-panel.tsx`, congelado, só leitura pra
 * contexto funcional): mapeei a MESMA posição estrutural (rodapé, ação com
 * seta) pra uma ação real.
 *
 * ESCOPO FECHADO: só a tab `mcps` do filtro pronto (skills/subagentes ficam
 * de fora — a tarefa não pediu). Não toca em `apps/web`, na gaveta nem no
 * composer.
 */
import { useCallback, useEffect, useState } from 'react';
import { getAgentMcp, patchAgentMcp, postAgentMcpReload } from '@grupo_borges/cockpit-core/api';
import type { McpServer } from '@grupo_borges/cockpit-core/api';
import { Busca } from '../gaveta/filtros-de-conversa';
import { Bloco, Cartao, Pilula } from '../gaveta/pecas';
import { IconeReenviar } from './icones';
import { LinhaDeServidor } from './linha-de-servidor-mcp';
import { combinaBusca, servidoresMcp } from './mcp-servidores';

const chaveDe = (s: McpServer) => `${s.kind}::${s.id}`;

type Carga = 'carregando' | 'pronto' | 'indisponivel';
type FaseReload = 'ocioso' | 'enviando' | 'entregue';

export function PainelMcp({ agentSlug }: { agentSlug: string }) {
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [carga, setCarga] = useState<Carga>('carregando');
  const [busca, setBusca] = useState('');
  const [emVoo, setEmVoo] = useState<ReadonlySet<string>>(new Set());
  const [falha, setFalha] = useState<string | null>(null);
  const [requerReload, setRequerReload] = useState(false);
  const [reload, setReload] = useState<FaseReload>('ocioso');

  const buscarServidores = useCallback(
    (signal?: AbortSignal) => {
      setCarga((atual) => (atual === 'pronto' ? atual : 'carregando'));
      getAgentMcp(agentSlug, signal)
        .then((res) => {
          if (signal?.aborted) return;
          setServers(res.servers);
          setCarga('pronto');
        })
        .catch(() => {
          if (signal?.aborted) return;
          setCarga('indisponivel');
        });
    },
    [agentSlug],
  );

  useEffect(() => {
    const controlador = new AbortController();
    buscarServidores(controlador.signal);
    return () => controlador.abort();
  }, [buscarServidores]);

  async function alternar(server: McpServer) {
    const chave = chaveDe(server);
    if (emVoo.has(chave)) return;
    const proximo = !server.enabled;
    const anterior = servers;

    setFalha(null);
    setEmVoo((atual) => new Set(atual).add(chave));
    // Aplica local SÓ no servidor tocado — todo outro item da lista mantém o
    // MESMO objeto (`.map` só troca o que casa a chave). É a metade 2 da
    // régua de pronto na prática: se este código reescrevesse a lista
    // inteira, a prova em `~/.claude.json` pegaria isso na hora.
    setServers((atual) => atual?.map((s) => (chaveDe(s) === chave ? { ...s, enabled: proximo } : s)) ?? atual);

    try {
      const resposta = await patchAgentMcp(agentSlug, server.kind, server.id, proximo);
      if (resposta.requires_reload) setRequerReload(true);
    } catch {
      setServers(anterior);
      setFalha(`não consegui ${proximo ? 'ativar' : 'desativar'} ${server.name}`);
    } finally {
      setEmVoo((atual) => {
        const proximoConjunto = new Set(atual);
        proximoConjunto.delete(chave);
        return proximoConjunto;
      });
    }
  }

  async function aplicarReload() {
    if (reload === 'enviando') return;
    setReload('enviando');
    setFalha(null);
    try {
      const resposta = await postAgentMcpReload(agentSlug);
      if (!resposta.tmux_delivered) {
        setFalha('o reload não chegou à sessão do agente');
        setReload('ocioso');
        return;
      }
      setRequerReload(false);
      setReload('entregue');
      setTimeout(() => setReload('ocioso'), 2200);
    } catch {
      setFalha('falha ao mandar o reload');
      setReload('ocioso');
    }
  }

  const lista = servers ? servidoresMcp(servers).filter((s) => combinaBusca(s, busca)) : [];

  return (
    // `flex-auto`, NÃO `flex-1` — a régua que o `Painel` da gaveta usa (02/08):
    // base `auto` (contribui o conteúdo) em vez de base 0, senão o WebKit abre
    // a gaveta com 0px de altura no iPhone. Desde 15ccf76 a tela nasceu sem
    // consumidor; a gaveta é a porta, e este section preenche o campo dela.
    <section aria-label="MCPs do agente" className="flex min-h-0 flex-auto flex-col" style={{ gap: 'var(--ck-space-2)' }}>
      <Busca valor={busca} muda={setBusca} dica="Buscar MCP" descricao="Buscar MCP" />

      <div className="flex min-h-0 flex-auto flex-col overflow-y-auto" style={{ gap: 'var(--ck-space-2)' }}>
        {carga === 'indisponivel' ? (
          <Recado texto="Não consegui ler os MCPs deste agente." aoTentar={() => buscarServidores()} />
        ) : null}

        {carga !== 'indisponivel' ? (
          <Cartao rotulo="MCPs">
            <Bloco style={{ gap: 0, padding: 'var(--ck-space-1) 0' }}>
              {carga === 'carregando' ? (
                // Altura reservada — mesma razão do `BlocoDeAcoes`: sem isto a lista
                // pula de tamanho quando os servidores chegam.
                <div aria-hidden style={{ height: '132px' }} />
              ) : null}

              {carga === 'pronto' && lista.length === 0 ? (
                <p role="status" style={{ padding: 'var(--ck-space-3) var(--ck-space-4)', fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}>
                  {busca ? 'Nenhum MCP bate com a busca.' : 'Nenhum MCP configurado.'}
                </p>
              ) : null}

              {lista.length > 0 ? (
                <ul className="flex flex-col">
                  {lista.map((server) => (
                    <LinhaDeServidor
                      key={chaveDe(server)}
                      server={server}
                      emVoo={emVoo.has(chaveDe(server))}
                      onToggle={() => void alternar(server)}
                    />
                  ))}
                </ul>
              ) : null}
            </Bloco>
          </Cartao>
        ) : null}
      </div>

      {falha ? (
        <p role="alert" style={{ padding: '0 var(--ck-space-4)', fontSize: 'var(--ck-text-sm)', color: 'var(--ck-state-attention)' }}>
          {falha}
        </p>
      ) : null}

      {requerReload ? (
        <Bloco>
          <p style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}>
            Mudança aplicada — falta recarregar a sessão pra valer.
          </p>
          <div className="flex">
            <Pilula
              aoTocar={() => void aplicarReload()}
              ocupado={reload === 'enviando'}
              cor={reload === 'entregue' ? 'var(--ck-state-ok)' : undefined}
            >
              <IconeReenviar tamanho={13} />
              {reload === 'enviando' ? 'Enviando…' : reload === 'entregue' ? 'Enviado' : 'Recarregar'}
            </Pilula>
          </div>
        </Bloco>
      ) : null}
    </section>
  );
}

/** Recado com saída — a mesma forma da falha no painel de Conversas. */
function Recado({ texto, aoTentar }: { texto: string; aoTentar: () => void }) {
  return (
    <Bloco>
      <p role="status" style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}>
        {texto}
      </p>
      <div className="flex">
        <Pilula aoTocar={aoTentar}>Tentar de novo</Pilula>
      </div>
    </Bloco>
  );
}
