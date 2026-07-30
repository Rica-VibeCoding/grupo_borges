'use client';

/**
 * BlocoDeAcoes — as ações rápidas do painel (§17, a metade que faltava).
 *
 * O Rica as chama de *"ideia central do painel"*, e as quatro decisões de forma
 * são dele, respondidas nesta rodada:
 *
 * 1. **O esforço entra aqui TAMBÉM**, mesmo já existindo no composer. A
 *    divergência que isso criaria (duas telas mostrando o mesmo valor, cada uma
 *    tendo buscado `/painel` uma vez) se resolve pelo `aberto`: toda abertura
 *    do painel re-busca. Custa uma chamada por abertura e nunca mostra valor
 *    velho — que é o defeito real, não a duplicação.
 * 2. **Segmentado**, não `select`: um toque = uma troca, sem menu no meio.
 * 3. **No topo**, antes dos seis campos de detalhe. Casa com o `.ck-flutua`
 *    ancorado no topo (a borda de cima nunca se move): as ações ficam à vista
 *    cresça o painel quanto crescer, e o que rola por dentro é a referência.
 * 4. **Destravar é toque simples.** O endpoint só manda Escape e é idempotente
 *    — sem modal aberto, vira no-op. A pressão longa de 2s do cockpit antigo
 *    existe para proteger o `/clear`, que zera contexto; herdar o gesto aqui
 *    seria copiar a proteção sem o perigo, e esconder atrás de dois segundos
 *    justamente a ação que salva o Rica de um agente travado.
 *
 * NÃO INVENTEI `/clear`. Ele é vizinho do destrava no cockpit antigo e seria o
 * quinto botão óbvio — mas o §17 lista quatro rotas, e é destrutivo. Entra
 * quando for pedido, não porque cabia.
 *
 * ARQUIVO NOVO DE PROPÓSITO, e o `app-shell.tsx` não é tocado: o Hiro está
 * mexendo na posição e na velocidade do mesmo painel. Nada aqui escreve no
 * `globals.css` pelo mesmo motivo (`.ck-flutua`/`.ck-surge` são dele nesta
 * rodada) — a pele usa só token e classe que já existem. A integração no JSX
 * do painel (`app/agente/[slug]/page.tsx`) é o passo seguinte, depois que o
 * commit dele fechar.
 *
 * A régua — quais controles existem, em que ordem, como se traduzem e o que
 * cada falha diz — mora em `acoes-rapidas.ts`, testada. Aqui fica só estado,
 * rede e pixel.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchAgentPainel,
  patchAgentCodexSandbox,
  patchAgentEffort,
  patchAgentPermissionMode,
  postAgentDestrava,
} from '@grupo_borges/cockpit-core/api';
import type {
  AgentPainelResponse,
  PainelCodexSandbox,
  PainelPermissionMode,
} from '@grupo_borges/cockpit-core/cockpit-types';

import {
  RECIBO_MS,
  descreveControle,
  diagnosticaAcao,
  leiaDestrava,
  montaControles,
  rotulaDestrava,
  type AcaoId,
  type Controle,
  type FaseDestrava,
  type Impedimento,
} from './acoes-rapidas';
import { IconeDescartar } from './icones';
import { usePainelAberto } from './painel-otimista';

/** As cinco chamadas que este bloco faz. Existe como prop para a vitrine poder
 *  exercitar falha e demora sem back nenhum — o mesmo papel do `faseForcada`
 *  no composer, só que sem contaminar o componente com estado de mentira. */
export type TransporteDeAcoes = {
  lePainel: (slug: string, signal?: AbortSignal) => Promise<AgentPainelResponse>;
  gravaEsforco: (slug: string, valor: string) => Promise<unknown>;
  gravaPermissao: (slug: string, valor: PainelPermissionMode) => Promise<unknown>;
  gravaSandbox: (slug: string, valor: PainelCodexSandbox) => Promise<unknown>;
  destrava: (slug: string) => Promise<{ tmux_delivered: boolean }>;
};

const TRANSPORTE_REAL: TransporteDeAcoes = {
  lePainel: fetchAgentPainel,
  gravaEsforco: patchAgentEffort,
  gravaPermissao: patchAgentPermissionMode,
  gravaSandbox: patchAgentCodexSandbox,
  destrava: postAgentDestrava,
};

export type BlocoDeAcoesProps = {
  agentSlug: string;
  /** O valor do SERVIDOR (`?painel=…`), usado no SSR e como fallback fora do
   *  `PainelProvider`. Dentro dele quem manda é o valor otimista — ver o corpo
   *  do componente. O painel fica SEMPRE montado (é o que compra a animação de
   *  saída da §17), então este booleano é a única forma de o bloco saber que
   *  voltou à tela — e cada volta re-busca. */
  aberto: boolean;
  /** Só a vitrine injeta. */
  transporte?: TransporteDeAcoes;
};

type Carga = 'ocioso' | 'carregando' | 'pronto' | 'indisponivel';

export function BlocoDeAcoes({ agentSlug, aberto: abertoDoServidor, transporte }: BlocoDeAcoesProps) {
  // O valor OTIMISTA, não o da URL. O painel abre no mesmo frame do clique
  // (`painel-otimista.tsx`, do Hiro) enquanto a navegação `?painel=…` leva
  // 2,0–2,7s para voltar do servidor. Reagir à URL faria a busca do `/painel`
  // chegar com esse atraso inteiro — o painel abriria mostrando o esforço
  // velho por dois segundos, que é justamente o defeito que esta re-busca
  // existe para evitar. Fora do provider (a vitrine `/acoes`) o hook devolve o
  // fallback, e o comportamento é o de antes.
  const aberto = usePainelAberto(abertoDoServidor);
  // O transporte é lido por REF, nunca como dependência de efeito. Quem passa
  // um objeto literal (`transporte={{...}}`) constrói um objeto novo a cada
  // render, e um efeito que dependesse dessa identidade re-buscaria em laço
  // infinito — foi exatamente o que a vitrine produziu na primeira conferência
  // no browser: overlay de erro do Next e só a primeira seção renderizada.
  // Transporte é parâmetro de construção, não estado; ref é a forma honesta de
  // dizer isso.
  const redeRef = useRef<TransporteDeAcoes>(transporte ?? TRANSPORTE_REAL);
  useEffect(() => {
    redeRef.current = transporte ?? TRANSPORTE_REAL;
  });

  const [painel, setPainel] = useState<AgentPainelResponse | null>(null);
  const [carga, setCarga] = useState<Carga>('ocioso');
  const [emVoo, setEmVoo] = useState<{ id: AcaoId; valor: string } | null>(null);
  const [falha, setFalha] = useState<Impedimento | null>(null);
  const [destrava, setDestrava] = useState<FaseDestrava>('ocioso');

  // Uma troca pode ser atropelada por outra (o dedo insiste). A resposta velha
  // não pode reverter o valor que a nova acabou de aplicar — sem isto, dois
  // toques rápidos com o primeiro falhando desfazem o segundo.
  const sequencia = useRef(0);
  const reciboTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buscar = useCallback(
    (signal?: AbortSignal) => {
      setCarga((atual) => (atual === 'pronto' ? atual : 'carregando'));
      redeRef.current
        .lePainel(agentSlug, signal)
        .then((novo) => {
          if (signal?.aborted) return;
          setPainel(novo);
          setCarga('pronto');
        })
        .catch(() => {
          if (signal?.aborted) return;
          // Painel fora do ar: os controles NÃO nascem fingidos. Mas também
          // não somem em silêncio — sumir sem dizer nada é o que faz o Rica
          // achar que o agente não tem controles.
          setCarga('indisponivel');
        });
    },
    [agentSlug],
  );

  useEffect(() => {
    if (!aberto) {
      // Fechou: a próxima abertura começa limpa. Aviso de falha guardado de
      // uma sessão anterior do painel não diz nada sobre o estado de agora.
      setFalha(null);
      return;
    }
    const controlador = new AbortController();
    buscar(controlador.signal);
    return () => controlador.abort();
  }, [aberto, buscar]);

  useEffect(
    () => () => {
      if (reciboTimer.current) clearTimeout(reciboTimer.current);
    },
    [],
  );

  /** Aplica no estado local antes da rede responder. O toque tem que responder
   *  na hora; se o back recusar, o valor volta e o aviso explica. É o mesmo
   *  desenho do esforço no composer. */
  function aplicaLocal(id: AcaoId, valor: string) {
    setPainel((atual) => {
      if (!atual) return atual;
      if (id === 'esforco') return { ...atual, effort: { ...atual.effort, value: valor } };
      if (id === 'permissao') {
        return { ...atual, permission: { ...atual.permission, mode: valor as PainelPermissionMode } };
      }
      if (id === 'sandbox' && atual.sandbox) {
        return { ...atual, sandbox: { ...atual.sandbox, value: valor as PainelCodexSandbox } };
      }
      return atual;
    });
  }

  async function trocar(controle: Controle, valor: string) {
    if (valor === controle.valor) return;
    const anterior = painel;
    const meu = ++sequencia.current;

    setFalha(null);
    setEmVoo({ id: controle.id, valor });
    aplicaLocal(controle.id, valor);

    try {
      const rede = redeRef.current;
      if (controle.id === 'esforco') await rede.gravaEsforco(agentSlug, valor);
      else if (controle.id === 'permissao') {
        await rede.gravaPermissao(agentSlug, valor as PainelPermissionMode);
      } else await rede.gravaSandbox(agentSlug, valor as PainelCodexSandbox);
    } catch (erro) {
      // Só a troca MAIS RECENTE tem direito de reverter.
      if (meu === sequencia.current) {
        setPainel(anterior);
        setFalha(diagnosticaAcao(erro, controle.id));
      }
    } finally {
      if (meu === sequencia.current) setEmVoo(null);
    }
  }

  async function acionarDestrava() {
    if (destrava === 'enviando') return;
    setFalha(null);
    setDestrava('enviando');
    try {
      const resposta = await redeRef.current.destrava(agentSlug);
      const aviso = leiaDestrava(resposta);
      if (aviso) {
        setFalha(aviso);
        setDestrava('ocioso');
        return;
      }
      setDestrava('entregue');
      if (reciboTimer.current) clearTimeout(reciboTimer.current);
      reciboTimer.current = setTimeout(() => setDestrava('ocioso'), RECIBO_MS);
    } catch (erro) {
      setDestrava('ocioso');
      setFalha({
        resumo: erro instanceof Error ? 'o destrava não chegou ao servidor' : 'o destrava falhou',
        saida: 'tente de novo; se repetir, a sessão do agente pode estar fora do ar',
      });
    }
  }

  const controles = painel ? montaControles(painel) : [];

  return (
    <section
      aria-label="ações rápidas"
      className="flex shrink-0 flex-col border-b"
      style={{
        gap: 'var(--ck-space-4)',
        padding: 'var(--ck-space-4)',
        // `edge-light`, não `hairline`: separador DENTRO de superfície
        // flutuante é o fio de luz da §17 — o hairline (#424242) é mais duro
        // que a textura que o Rica mediu na referência.
        borderColor: 'var(--ck-edge-light)',
      }}
    >
      {carga === 'indisponivel' ? (
        <Recado
          texto="não consegui ler os controles deste agente"
          rotuloAcao="Tentar de novo"
          aoAcionar={() => buscar()}
        />
      ) : null}

      {carga === 'carregando' && controles.length === 0 ? (
        // Altura reservada: sem isto os seis campos sobem e descem quando os
        // controles chegam, e o painel pisca a cada abertura.
        <div aria-hidden style={{ height: '96px' }} />
      ) : null}

      {controles.map((controle) => (
        <Segmentado
          key={controle.id}
          controle={controle}
          emVoo={emVoo?.id === controle.id ? emVoo.valor : null}
          aoEscolher={(valor) => void trocar(controle, valor)}
        />
      ))}

      {carga === 'pronto' ? (
        // A linha "Fecha modal que travou o campo…" saiu por ordem do Rica
        // (30/07): *"pode retirar os textos explicativos"*, citando-a pelo
        // nome. Nada entrou no lugar — o que o botão faz continua dito no
        // `aria-label`, que já existia e não é enfeite de tela.
        <button
            type="button"
            onClick={() => void acionarDestrava()}
            aria-busy={destrava === 'enviando'}
            aria-label="Destravar o agente — envia Escape no terminal dele"
            className="ck-veil flex w-full items-center justify-center border"
            style={{
              minHeight: 'var(--ck-touch-min)',
              padding: '0 var(--ck-space-3)',
              borderRadius: 'var(--ck-radius-frame)',
              borderColor: 'var(--ck-edge-functional)',
              fontSize: 'var(--ck-text-sm)',
              // O recibo muda a PALAVRA, não só a cor: cor sozinha nunca é
              // portadora de significado (§3/§9.7).
              color: destrava === 'entregue' ? 'var(--ck-state-ok)' : 'var(--ck-text-primary)',
              transition: 'color var(--ck-dur-fast) var(--ck-ease)',
            }}
          >
          {rotulaDestrava(destrava)}
        </button>
      ) : null}

      {falha ? (
        <div
          className="flex items-start justify-between"
          style={{ gap: 'var(--ck-space-3)' }}
          role="status"
          aria-live="assertive"
        >
          <span style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-state-attention)' }}>
            {falha.resumo} — {falha.saida}
          </span>
          <button
            type="button"
            onClick={() => setFalha(null)}
            aria-label="Dispensar aviso"
            className="ck-veil flex shrink-0 items-center"
            style={{
              padding: '4px',
              borderRadius: 'var(--ck-radius-chip)',
              color: 'var(--ck-text-secondary)',
            }}
          >
            <IconeDescartar tamanho={13} />
          </button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * O segmentado. Trilho em `--ck-surface-composer` (um degrau acima do `nav` do
 * painel), segmentos de largura igual.
 *
 * O SELECIONADO É UMA PASTILHA ELEVADA — ordem do Rica, 30/07, olhando a
 * primeira versão: *"tira essa linha branca de selecionado, vamos pensar em
 * algo mais discreto que pegue o botão todo"*. A barra de 2px saiu.
 *
 * No lugar dela o segmento ativo **sobe um degrau da escada de superfícies**
 * (`raised` sobre o trilho em `composer`) e ganha o fio de luz de 1px no topo
 * (`.ck-lit`). Isto responde às duas metades do pedido: pega o botão inteiro,
 * porque é a superfície dele que muda; e é discreto, porque o degrau é o mesmo
 * que separa qualquer duas camadas do app — nada de branco puro.
 *
 * Não é "cor sozinha" (§9.7). O que carrega a seleção é ELEVAÇÃO mais TEXTURA
 * (o fio de luz), que é exatamente a linguagem com que este app separa camadas
 * desde a §2.5 — "luz em vez de sombra", nunca matiz. A §2.6 pedia véu + barra
 * de 2px à esquerda pensando em ITEM DE LISTA; aqui o alvo é um grupo de
 * botões contíguos, e um grid de traços verticais não se lê como seleção.
 *
 * O ativo perde o `.ck-veil` por obrigação, não por escolha: véu de interação
 * sobre `raised` derruba a borda funcional para 2.98:1 (proibição §9.11).
 *
 * O rótulo longo (`extra alto`) quebra em duas linhas em vez de encolher a
 * fonte ou truncar: com 380px de painel e cinco níveis, cada segmento tem ~69px
 * e é o único jeito de mostrar a palavra inteira sem inventar uma abreviação
 * que divergiria da tradução do `motor.ts`.
 */
function Segmentado({
  controle,
  emVoo,
  aoEscolher,
}: {
  controle: Controle;
  emVoo: string | null;
  aoEscolher: (valor: string) => void;
}) {
  return (
    <div className="flex flex-col" style={{ gap: 'var(--ck-space-2)' }}>
      <span
        style={{
          fontSize: 'var(--ck-text-xs)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--ck-track-overline)',
          color: 'var(--ck-text-secondary)',
        }}
      >
        {controle.titulo}
      </span>

      <div
        role="group"
        aria-label={descreveControle(controle)}
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${controle.opcoes.length}, minmax(0, 1fr))`,
          gap: '3px',
          padding: '3px',
          borderRadius: 'var(--ck-radius-frame)',
          background: 'var(--ck-surface-composer)',
        }}
      >
        {controle.opcoes.map((opcao) => {
          const ativo = opcao.valor === controle.valor;
          const voando = emVoo === opcao.valor;
          return (
            <button
              key={opcao.valor}
              type="button"
              onClick={() => aoEscolher(opcao.valor)}
              aria-pressed={ativo}
              aria-busy={voando}
              title={opcao.descricao}
              // O ativo NÃO leva `.ck-veil`: véu de interação sobre
              // `--ck-surface-raised` derruba a borda funcional para 2.98:1 e
              // é proibição expressa (§9.11). Ele já é o destaque; quem precisa
              // de hover e press é o inativo.
              className={`flex items-center justify-center text-center ${ativo ? 'ck-lit' : 'ck-veil'}`}
              style={{
                minHeight: 'var(--ck-touch-min)',
                padding: '0 var(--ck-space-1)',
                borderRadius: 'var(--ck-radius-chip)',
                fontSize: 'var(--ck-text-sm)',
                lineHeight: 'var(--ck-leading-body)',
                color: ativo ? 'var(--ck-text-primary)' : 'var(--ck-text-secondary)',
                // O selecionado é uma PASTILHA ELEVADA: sobe um degrau da
                // escada de superfícies e ganha o fio de luz de 1px no topo
                // (`.ck-lit`). Ver o comentário do componente.
                background: ativo ? 'var(--ck-surface-raised)' : undefined,
                // Em voo o rótulo esmaece e o `aria-busy` avisa quem não vê. O
                // texto NÃO vira "salvando": trocar a palavra mudaria a largura
                // e a linha inteira pularia no meio do toque.
                opacity: voando ? 0.55 : 1,
                transition: 'opacity var(--ck-dur-fast) var(--ck-ease)',
              }}
            >
              {opcao.rotulo}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Recado com saída. Nunca só o diagnóstico — a mesma régua do `voz.ts`. */
function Recado({
  texto,
  rotuloAcao,
  aoAcionar,
}: {
  texto: string;
  rotuloAcao: string;
  aoAcionar: () => void;
}) {
  return (
    <div
      className="flex items-center justify-between"
      style={{ gap: 'var(--ck-space-2)' }}
      role="status"
    >
      <span style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}>
        {texto}
      </span>
      <button
        type="button"
        onClick={aoAcionar}
        className="ck-veil flex shrink-0 items-center"
        style={{
          minHeight: 'var(--ck-touch-min)',
          padding: '0 var(--ck-space-2)',
          borderRadius: 'var(--ck-radius-chip)',
          fontSize: 'var(--ck-text-xs)',
          color: 'var(--ck-text-primary)',
        }}
      >
        {rotuloAcao}
      </button>
    </div>
  );
}
