'use client';

/**
 * PainelMcp — a tela de MCPs (tarefa `8764d666`, 09/08).
 *
 * O back já existe inteiro (`apps/api/routers/agents.py:1681`, JP-25): quatro
 * origens (plugin/mcp.json/remote/user_scope) com `enabled` resolvido e
 * credencial redigida, PATCH que sabe onde cada origem se desliga, reload que
 * manda `/reload-plugins` pro tmux. Este arquivo só consome — a régua pura
 * (filtro, busca, ordenação, o aviso de efeito colateral) mora em
 * `mcp-servidores.ts`, testada; aqui fica estado, rede e pixel, mesma divisão
 * de `bloco-de-acoes.tsx`.
 *
 * A REFERÊNCIA do Rica (`docs/referencias-ui/mcps-referencia-lista-fundo-branco-09-08.jpg`)
 * é a MODELAGEM, não os pixels: campo de busca no topo, uma linha por
 * servidor (ícone à esquerda, nome, ação à direita), densidade baixa, sem
 * cartão nem borda por item. É tela do ChatGPT em tema claro, mas o cockpit é
 * `color-scheme: dark` por contrato — a tela nasce na paleta do app, com
 * superfície PRÓPRIA (`--ck-surface-mcp`, ver `globals.css`), não emprestada
 * de outro token.
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
import { IconeBusca, IconeReenviar } from './icones';
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
    <section
      aria-label="MCPs do agente"
      className="flex min-h-0 flex-auto flex-col"
      style={{ background: 'var(--ck-surface-mcp)', borderRadius: 'var(--ck-radius-caixa)' }}
    >
      <div style={{ padding: 'var(--ck-space-3)' }}>
        <div
          className="flex items-center"
          style={{
            gap: 'var(--ck-space-2)',
            padding: '0 var(--ck-space-3)',
            minHeight: 'var(--ck-touch-min)',
            borderRadius: 'var(--ck-radius-frame)',
            background: 'var(--ck-surface-composer)',
            // Borda de campo (`--ck-edge-functional`, estética §2): a do composer
            // é só da caixa dele. Não há token de foco para a funcional — o
            // cursor no campo é o sinal.
            border: '1px solid var(--ck-edge-functional)',
          }}
        >
          <IconeBusca tamanho={15} style={{ color: 'var(--ck-text-tertiary)', flexShrink: 0 }} />
          <input
            type="text"
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
            placeholder="Buscar MCP"
            aria-label="Buscar MCP"
            className="min-w-0 flex-1 bg-transparent outline-none"
            style={{
              fontFamily: 'var(--ck-font-sans)',
              // 16px: abaixo disso o Safari dá zoom ao focar (regra 3 do CLAUDE.md).
              fontSize: 'var(--ck-text-md)',
              color: 'var(--ck-text-primary)',
            }}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: '0 var(--ck-space-3) var(--ck-space-3)' }}>
        {carga === 'indisponivel' ? (
          <Recado texto="não consegui ler os MCPs deste agente" aoTentar={() => buscarServidores()} />
        ) : null}

        {carga === 'carregando' ? (
          // Altura reservada — mesma razão do `BlocoDeAcoes`: sem isto a lista
          // pula de tamanho quando os servidores chegam.
          <div aria-hidden style={{ height: '132px' }} />
        ) : null}

        {carga === 'pronto' && lista.length === 0 ? (
          <p style={{ padding: 'var(--ck-space-3)', fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}>
            {busca ? 'nenhum MCP bate com a busca' : 'nenhum MCP configurado'}
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
      </div>

      {falha ? (
        <p
          role="alert"
          style={{
            margin: '0 var(--ck-space-3) var(--ck-space-3)',
            fontSize: 'var(--ck-text-xs)',
            color: 'var(--ck-state-attention)',
          }}
        >
          {falha}
        </p>
      ) : null}

      {requerReload ? (
        <footer
          className="flex items-center justify-between"
          style={{
            gap: 'var(--ck-space-2)',
            padding: 'var(--ck-space-3)',
            borderTop: '1px solid var(--ck-edge-hairline)',
          }}
        >
          <span style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}>
            Mudança aplicada — falta recarregar a sessão pra valer
          </span>
          <button
            type="button"
            onClick={() => void aplicarReload()}
            aria-busy={reload === 'enviando'}
            className="ck-veil flex shrink-0 items-center"
            style={{
              gap: 'var(--ck-space-1)',
              minHeight: 'var(--ck-touch-min)',
              padding: '0 var(--ck-space-3)',
              borderRadius: 'var(--ck-radius-chip)',
              fontSize: 'var(--ck-text-sm)',
              whiteSpace: 'nowrap',
              color: reload === 'entregue' ? 'var(--ck-state-ok)' : 'var(--ck-text-primary)',
            }}
          >
            <IconeReenviar tamanho={13} />
            {reload === 'enviando' ? 'enviando…' : reload === 'entregue' ? 'enviado' : 'Recarregar'}
          </button>
        </footer>
      ) : null}
    </section>
  );
}

/** Recado com saída — mesma régua do `BlocoDeAcoes`. */
function Recado({ texto, aoTentar }: { texto: string; aoTentar: () => void }) {
  return (
    <div className="flex items-center justify-between" style={{ gap: 'var(--ck-space-2)', padding: 'var(--ck-space-3)' }} role="status">
      <span style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}>{texto}</span>
      <button
        type="button"
        onClick={aoTentar}
        className="ck-veil flex shrink-0 items-center"
        style={{
          minHeight: 'var(--ck-touch-min)',
          padding: '0 var(--ck-space-2)',
          borderRadius: 'var(--ck-radius-chip)',
          fontSize: 'var(--ck-text-xs)',
          color: 'var(--ck-text-primary)',
        }}
      >
        Tentar de novo
      </button>
    </div>
  );
}
