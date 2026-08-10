'use client';

/**
 * BlocoDeAcoes — as ações rápidas do painel (§17, a metade que faltava).
 *
 * O Rica as chama de *"ideia central do painel"*, e as quatro decisões de forma
 * são dele, respondidas nesta rodada:
 *
 * 1. ~~**O esforço entra aqui TAMBÉM**, mesmo já existindo no composer.~~
 *    **REVOGADO por ele em 09/08**, revendo a gaveta item por item: *"já temos
 *    ele no input"*. O seletor de esforço mora no composer (`seletor-motor.tsx`)
 *    e ter os dois era duplicata — a re-busca por abertura que resolvia a
 *    divergência entre as duas telas deixou de ter duas telas para conciliar.
 *    Ela continua valendo para o que ficou (permissão e sandbox), que é lido do
 *    mesmo `/painel`.
 * 2. **Segmentado**, não `select`: um toque = uma troca, sem menu no meio.
 * 3. **No topo**, antes dos seis campos de detalhe. Casa com o `.ck-flutua`
 *    ancorado no topo (a borda de cima nunca se move): as ações ficam à vista
 *    cresça o painel quanto crescer, e o que rola por dentro é a referência.
 * 4. **Destravar é toque simples.** O endpoint manda até 3 Escapes (03/08: um
 *    só raramente resolve overlay em camada) e é idempotente — sem nada pra
 *    fechar, vira no-op. A pressão longa de 2s do cockpit antigo existe para
 *    proteger o `/clear`, que zera contexto; herdar o gesto aqui seria copiar
 *    a proteção sem o perigo, e esconder atrás de dois segundos justamente a
 *    ação que salva o Rica de um agente travado. O backend checa o estado
 *    ENTRE cada Escape e para assim que confirma "vazio" — nunca manda dois
 *    seguidos sobre um prompt já vazio, que é o atalho nativo do próprio
 *    Claude Code pra abrir o menu de rewind (Esc+Esc).
 *
 * `/clear` nunca entrou — mas o **Restart** (03/08) é o vizinho ainda mais
 * destrutivo que a nota original dizia não ter inventado: zera a conversa
 * inteira, não só o contexto de sessão. Entrou porque foi pedido explicitamente
 * pelo Rica (o destravar 1x raramente resolvia; o relançar com `--resume`
 * às vezes nem confirma o resume se a âncora não bate) — mesma régua de
 * sempre, o botão nasce do pedido, não da simetria com o que já existe.
 *
 * A régua — quais controles existem, em que ordem, como se traduzem e o que
 * cada falha diz — mora em `acoes-rapidas.ts`, testada. Aqui fica só estado,
 * rede e pixel.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchAgentPainel,
  patchAgentCodexSandbox,
  patchAgentPermissionMode,
  postAgentDesligar,
  postAgentDestrava,
  postAgentLigar,
  postAgentRelaunch,
} from '@grupo_borges/cockpit-core/api';
import type {
  AgentPainelResponse,
  PainelCodexSandbox,
  PainelPermissionMode,
} from '@grupo_borges/cockpit-core/cockpit-types';

import {
  CONFIRMA_ACAO_MS,
  RECIBO_MS,
  RETENTA_PAINEL_BASE_MS,
  RETENTA_PAINEL_TETO_MS,
  descreveAcaoBruta,
  descreveControle,
  descreveLigar,
  diagnosticaAcao,
  diagnosticaCicloDeVida,
  diagnosticaRelancar,
  ehCodex,
  leiaDesligar,
  leiaDestrava,
  leiaLigar,
  leiaRelancar,
  montaControles,
  rotulaAcaoBruta,
  rotulaDestrava,
  rotulaLigar,
  type AcaoBruta,
  type AcaoId,
  type Controle,
  type FaseBruta,
  type FaseDestrava,
  type Impedimento,
} from './acoes-rapidas';
import { BlocoDeCota } from './bloco-de-cota';
import { IconeDescartar } from './icones';
import { usaCompact } from '../../lib/compact';
import { usePainelAberto } from './superficie-otimista';

/** Tempo que a confirmação do destrava-durante-compact fica armada. Passou,
 *  o botão volta ao normal — confirmação que expira não prende o dedo de
 *  ninguém num estado que ele já esqueceu. */
const CONFIRMA_COMPACT_MS = 4_000;


/** As chamadas que este bloco faz, contra o agente de verdade. Já foram
 *  injetáveis por prop para a vitrine `/acoes` exercitar falha e demora sem
 *  back; a vitrine morreu em 02/08 e a injeção foi junto — o painel fala com o
 *  agente e ponto. */
const REDE = {
  lePainel: fetchAgentPainel,
  gravaPermissao: patchAgentPermissionMode,
  gravaSandbox: patchAgentCodexSandbox,
  destrava: postAgentDestrava,
  relanca: postAgentRelaunch,
  desliga: postAgentDesligar,
  liga: postAgentLigar,
};

/**
 * O ciclo das ações brutas (armar → confirmar → enviar → recibo) pros DOIS
 * botões (Resume/Desligar) de uma vez — um `estado` só, não uma instância por
 * ação.
 *
 * Auditoria 03/08 achou a versão anterior (uma instância de hook por botão,
 * cada uma com sua própria `fase`) com uma brecha: nada impedia armar/disparar
 * os dois ao mesmo tempo (o back segura via lock e devolve 409, mas a
 * mensagem manda diagnosticar a infra quando o problema foi o dedo). Um
 * estado compartilhado fecha a brecha de graça: só uma `acao` por vez pode
 * estar fora de `ocioso`, e o rótulo curto "Confirmar?" nunca aparece em dois
 * botões ao mesmo tempo — o botão inativo sempre mostra seu rótulo normal.
 *
 * `setFalha` vem de fora — o painel tem UM aviso de erro só, não um por botão.
 * `aoConcluir` também: desligar muda a `vida` do agente, e sem re-buscar o
 * painel o Rica ficaria olhando os botões do agente vivo depois de tirá-lo do
 * ar — o botão certo (Ligar) só apareceria se ele fechasse e reabrisse a gaveta.
 */
function useAcaoBruta(
  agentSlug: string,
  aberto: boolean,
  setFalha: (falha: Impedimento | null) => void,
  aoConcluir: () => void,
) {
  const [estado, setEstado] = useState<{ acao: AcaoBruta; fase: FaseBruta } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Painel fechado desarma. Confirmação armada é uma pergunta aberta na tela;
  // se ela saiu, a pergunta caducou — reabrir e achar o botão já no "tocar de
  // novo confirma" faria um toque distraído matar a conversa.
  useEffect(() => {
    if (aberto) return;
    setEstado((atual) => (atual?.fase === 'confirmando' ? null : atual));
    if (timer.current) clearTimeout(timer.current);
  }, [aberto]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function acionar(acao: AcaoBruta) {
    // Qualquer ação em voo bloqueia os DOIS botões, não só o que foi clicado —
    // é a mesma trava que impede o dedo de disparar duas ao mesmo tempo.
    if (estado?.fase === 'enviando') return;

    // Primeiro toque ARMA. Clicar numa ação diferente da que já estava armada
    // reinicia a pergunta pra ação nova — o dedo mudou de ideia, não precisa
    // de um terceiro toque pra "cancelar" a anterior.
    if (estado?.acao !== acao || estado.fase !== 'confirmando') {
      setFalha(null);
      setEstado({ acao, fase: 'confirmando' });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setEstado((atual) => (atual?.fase === 'confirmando' ? null : atual));
      }, CONFIRMA_ACAO_MS);
      return;
    }

    if (timer.current) clearTimeout(timer.current);
    setFalha(null);
    setEstado({ acao, fase: 'enviando' });
    try {
      const aviso =
        acao === 'desligar'
          ? leiaDesligar(await REDE.desliga(agentSlug))
          : leiaRelancar(await REDE.relanca(agentSlug));
      if (aviso) {
        setFalha(aviso);
        setEstado(null);
        // Desligar que avisou ainda pode ter encerrado a sessão — o aviso é
        // sobre o que resistiu, não sobre nada ter acontecido. Reler é o que
        // impede a tela de discordar do estado real da máquina.
        if (acao === 'desligar') aoConcluir();
        return;
      }
      setEstado({ acao, fase: 'concluido' });
      if (acao === 'desligar') aoConcluir();
      timer.current = setTimeout(() => setEstado(null), RECIBO_MS);
    } catch (erro) {
      setEstado(null);
      setFalha(
        acao === 'desligar'
          ? diagnosticaCicloDeVida(erro, 'desligar')
          : diagnosticaRelancar(erro),
      );
    }
  }

  const faseDe = (acao: AcaoBruta): FaseBruta => (estado?.acao === acao ? estado.fase : 'ocioso');
  return { faseDe, acionar } as const;
}

/** Um dos dois botões de ação bruta (Resume/Desligar) — mesmo pixel, mesma
 *  régua de cor, só a `acao` (e por consequência a `fase` e o rótulo) muda. */
function BotaoAcaoBruta({
  fase,
  acao,
  onClick,
}: {
  fase: FaseBruta;
  acao: AcaoBruta;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-busy={fase === 'enviando'}
      aria-label={descreveAcaoBruta(fase, acao)}
      className="ck-veil flex flex-1 items-center justify-center overflow-hidden border"
      style={{
        minHeight: 'var(--ck-touch-min)',
        padding: '0 var(--ck-space-2)',
        borderRadius: 'var(--ck-radius-frame)',
        borderColor: 'var(--ck-edge-functional)',
        fontSize: 'var(--ck-text-sm)',
        whiteSpace: 'nowrap',
        // Mesma régua do destrava: a PALAVRA muda junto com a cor, nunca a
        // cor sozinha (§3/§9.7).
        color:
          fase === 'confirmando'
            ? 'var(--ck-state-attention)'
            : fase === 'concluido'
              ? 'var(--ck-state-ok)'
              : 'var(--ck-text-primary)',
        transition: 'color var(--ck-dur-fast) var(--ck-ease)',
      }}
    >
      {rotulaAcaoBruta(fase, acao)}
    </button>
  );
}

export type BlocoDeAcoesProps = {
  agentSlug: string;
  /** Fallback usado apenas fora do `PainelProvider`. Hoje o call-site passa
   *  sempre `false`; dentro do provider, o gatilho real da re-busca é o valor
   *  otimista do contexto. */
  aberto: boolean;
};

type Carga = 'ocioso' | 'carregando' | 'pronto' | 'indisponivel';

export function BlocoDeAcoes({ agentSlug, aberto: abertoDoServidor }: BlocoDeAcoesProps) {
  // O valor OTIMISTA, não o da URL. O painel abre no mesmo frame do clique
  // (`superficie-otimista.tsx`, do Hiro) enquanto a navegação `?painel=…` leva
  // 2,0–2,7s para voltar do servidor. Reagir à URL faria a busca do `/painel`
  // chegar com esse atraso inteiro — o painel abriria mostrando o esforço
  // velho por dois segundos, que é justamente o defeito que esta re-busca
  // existe para evitar. Fora do provider o hook devolve o fallback.
  const aberto = usePainelAberto(abertoDoServidor);

  const [painel, setPainel] = useState<AgentPainelResponse | null>(null);
  const [carga, setCarga] = useState<Carga>('ocioso');
  const [emVoo, setEmVoo] = useState<{ id: AcaoId; valor: string } | null>(null);
  const [falha, setFalha] = useState<Impedimento | null>(null);
  const [destrava, setDestrava] = useState<FaseDestrava>('ocioso');
  const [ligar, setLigar] = useState<FaseDestrava>('ocioso');
  const [retentativa, setRetentativa] = useState(0);

  // Destravar DURANTE um `/compact` interrompe o resumo — foi o acidente de
  // 02/08. O destrava continua acessível (agente travado é pior que compact
  // perdido), mas o primeiro toque vira aviso e só o segundo dispara. Só a
  // fase `compactando` pede confirmação: no `concluindo` o resumo já existe e
  // no `sem-retorno` o composer já está livre — proteger esses dois seria
  // copiar a proteção sem o perigo, como a pressão longa do cockpit antigo.
  const { estado: estadoCompact, cancelar: cancelarCompact } = usaCompact(agentSlug);
  const compactEmVoo = estadoCompact.fase === 'compactando';
  const [confirmaCompact, setConfirmaCompact] = useState(false);
  const confirmaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // O compact terminou (ou o painel fechou) com a confirmação armada: desarma
    // — o toque seguinte tem de ser lido do zero, não herdar um "quase" velho.
    if (compactEmVoo) return;
    setConfirmaCompact(false);
    if (confirmaTimer.current) clearTimeout(confirmaTimer.current);
  }, [compactEmVoo, aberto]);

  useEffect(
    () => () => {
      if (confirmaTimer.current) clearTimeout(confirmaTimer.current);
    },
    [],
  );

  // Uma troca pode ser atropelada por outra (o dedo insiste). A resposta velha
  // não pode reverter o valor que a nova acabou de aplicar — sem isto, dois
  // toques rápidos com o primeiro falhando desfazem o segundo.
  const sequencia = useRef(0);
  const reciboTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buscar = useCallback(
    (signal?: AbortSignal) => {
      setCarga((atual) => (atual === 'pronto' ? atual : 'carregando'));
      REDE
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

  // Depois do `buscar` de propósito: ligar e desligar mudam a `vida` do agente,
  // e é a re-leitura do painel que troca os botões na tela. O `signal` fica de
  // fora — esta releitura não pertence à sessão de abertura da gaveta, ela é a
  // consequência de uma ação que o Rica acabou de tomar.
  const { faseDe: faseBruta, acionar: acionarBruta } = useAcaoBruta(
    agentSlug,
    aberto,
    setFalha,
    buscar,
  );
  const relancar = faseBruta('resume');
  const desligar = faseBruta('desligar');

  // O controlador é da ABERTURA, não de uma leitura. Toda busca desta sessão de
  // painel — a primeira e cada retentativa — morre junto quando a gaveta fecha
  // ou o agente troca, e só então. Era um controlador por rodada de backoff, e
  // o cleanup da rodada abortava o fetch que o próprio timeout tinha acabado de
  // disparar (ver o efeito da retentativa abaixo).
  const sessao = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!aberto) {
      // Fechou: a próxima abertura começa limpa. Aviso de falha guardado de
      // uma sessão anterior do painel não diz nada sobre o estado de agora.
      setFalha(null);
      return;
    }
    const controlador = new AbortController();
    sessao.current = controlador;
    buscar(controlador.signal);
    return () => controlador.abort();
  }, [aberto, buscar]);

  // O painel se reconecta sozinho. Antes disto, uma única falha de rede deixava
  // `carga` em `indisponivel` para sempre — o `buscar` só rodava de novo se o
  // Rica fechasse e reabrisse a gaveta. Um restart da API de 6 segundos bastava
  // para os controles sumirem da tela dele e não voltarem, que foi o incidente
  // de 02/08 ("essa merda desse botão não volta"). `retentativa` é state, não
  // ref, de propósito: o `.catch` do `buscar` reescreve `indisponivel` com o
  // mesmo valor e o React não re-renderiza, então sem um valor que muda a cada
  // rodada o agendamento pararia na primeira tentativa.
  useEffect(() => {
    // O painel VOLTOU (ou a gaveta fechou): a próxima queda recomeça do degrau
    // de baixo. O reset é em `pronto`, não em "deixou de ser indisponível" —
    // a retentativa passa por `carregando` no caminho, e zerar ali devolveria o
    // expoente a zero a cada rodada: o backoff nunca sairia dos 2s.
    if (!aberto || carga === 'pronto') {
      if (retentativa !== 0) setRetentativa(0);
      return;
    }
    if (carga !== 'indisponivel') return;
    const espera = Math.min(
      RETENTA_PAINEL_BASE_MS * 2 ** retentativa,
      RETENTA_PAINEL_TETO_MS,
    );
    const agendado = setTimeout(() => {
      setRetentativa((n) => n + 1);
      // O signal é o da ABERTURA, nunca um desta rodada. `retentativa` está nas
      // dependências (é o que reagenda a rodada seguinte), então o bump aqui
      // re-roda este efeito no mesmo tick — e um cleanup que abortasse mataria
      // a busca que a linha de cima acabou de disparar. O painel só voltava por
      // acidente de timing.
      buscar(sessao.current?.signal);
    }, espera);
    return () => clearTimeout(agendado);
  }, [aberto, carga, retentativa, buscar]);

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
      const rede = REDE;
      if (controle.id === 'permissao') {
        await rede.gravaPermissao(agentSlug, valor as PainelPermissionMode);
      } else await rede.gravaSandbox(agentSlug, valor as PainelCodexSandbox);
    } catch (erro) {
      // O aviso vale sempre — o Rica precisa saber que a troca não pegou
      // mesmo quando o dedo já tocou em outro controle antes desta responder.
      // Só REVERTER é privilégio da troca mais recente: desfazer uma troca
      // velha apagaria uma troca nova que já teve sucesso.
      setFalha(diagnosticaAcao(erro, controle.id));
      if (meu === sequencia.current) {
        setPainel(anterior);
      }
    } finally {
      if (meu === sequencia.current) setEmVoo(null);
    }
  }

  async function acionarDestrava() {
    if (destrava === 'enviando') return;
    // Compact em voo: o primeiro toque ARMA, não dispara. O Escape que sai
    // agora corta o resumo ao meio — o Rica decide isso sabendo, não por
    // acidente. Confirmado, a máquina do compact é cancelada ANTES do disparo:
    // sem isto a barra continuaria esperando um resumo que o Escape matou.
    if (compactEmVoo && !confirmaCompact) {
      setConfirmaCompact(true);
      if (confirmaTimer.current) clearTimeout(confirmaTimer.current);
      confirmaTimer.current = setTimeout(() => setConfirmaCompact(false), CONFIRMA_COMPACT_MS);
      return;
    }
    if (confirmaCompact) {
      setConfirmaCompact(false);
      if (confirmaTimer.current) clearTimeout(confirmaTimer.current);
      cancelarCompact();
    }
    setFalha(null);
    setDestrava('enviando');
    try {
      const resposta = await REDE.destrava(agentSlug);
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

  async function acionarLigar() {
    if (ligar === 'enviando') return;
    setFalha(null);
    setLigar('enviando');
    try {
      const aviso = leiaLigar(await REDE.liga(agentSlug));
      // Relê o painel em qualquer desfecho: mesmo com o aviso de "ainda não
      // apareceu de pé", o boot pode ter concluído entre a resposta e agora.
      buscar();
      if (aviso) {
        setFalha(aviso);
        setLigar('ocioso');
        return;
      }
      setLigar('entregue');
      if (reciboTimer.current) clearTimeout(reciboTimer.current);
      reciboTimer.current = setTimeout(() => setLigar('ocioso'), RECIBO_MS);
    } catch (erro) {
      setLigar('ocioso');
      setFalha(diagnosticaCicloDeVida(erro, 'ligar'));
    }
  }

  const controles = painel ? montaControles(painel) : [];
  // O back recusaria com 409 `relaunch_somente_claude_code`, mas oferecer um
  // botão que só existe para dar erro é pior do que não oferecer: `--resume` é
  // conceito de Claude Code, e a Tara retoma thread por outro caminho. Vale
  // igual pro Desligar/Ligar: a Tara não fica de pé entre turnos, então não há
  // o que desligar nem o que subir.
  const codex = painel ? ehCodex(painel) : false;

  // O agente está DE PÉ? Só o painel lido responde — enquanto a busca não
  // voltou, `painel` é `null` e as ações nem são renderizadas (`carga` ainda
  // não é `pronto`). Casca morta (sessão viva, CLI morto) conta como fora do
  // ar: lá o Destravar responde `pane_incompativel` e o Resume devolve
  // `attempted:false`, então oferecer os dois seria oferecer botão morto.
  const dePe = painel?.vida.processo ?? true;

  // Aviso de confirmação de largura cheia — o rótulo DENTRO do botão é sempre
  // curto ("Confirmar?"), a frase que explica o que se perde mora aqui embaixo
  // (auditoria 03/08: a frase inteira dentro do botão de ~110px cortava antes
  // de "tocar de novo confirma", que é o próprio aviso do toque destrutivo).
  const avisoConfirmacao =
    confirmaCompact && compactEmVoo
      ? 'Confirmar? Destravar agora interrompe o resumo do compact — tocar de novo confirma'
      : relancar === 'confirmando'
        ? descreveAcaoBruta(relancar)
        : desligar === 'confirmando'
          ? descreveAcaoBruta(desligar, 'desligar')
          : null;

  return (
    <>
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

        {carga !== 'pronto' && carga !== 'indisponivel' && controles.length === 0 ? (
          // Altura do que vem: segmentado (overline 16 + gap 8 + trilho 50) +
          // linha de botões (gap 16 + 44). Medido no iPhone em 09/08, e as duas
          // metades estavam erradas: 96px era MENOS que o conteúdo, e a condição
          // era `carga === 'carregando'`, que só vale depois de a busca sair —
          // nos ~2s de `ocioso` entre hidratação e fetch não havia reserva
          // nenhuma. A gaveta abria em 244px e parava em 486, levando o **MCPs**
          // (alvo de toque, logo abaixo) 240px pra baixo com o dedo no ar.
          // `indisponivel` fica de fora: lá quem ocupa a altura é o `Recado`.
          <div aria-hidden style={{ height: '134px' }} />
        ) : null}

        {controles.map((controle) => (
          <Segmentado
            key={controle.id}
            controle={controle}
            emVoo={emVoo?.id === controle.id ? emVoo.valor : null}
            aoEscolher={(valor) => void trocar(controle, valor)}
          />
        ))}

        {carga === 'pronto' && !dePe && !codex ? (
          // AGENTE FORA DO AR — desligado ou casca morta. Destravar e Resume
          // SOMEM: não há o que destravar nem o que retomar, e os dois falham em
          // silêncio nesse estado (`pane_incompativel` / `attempted:false`), que
          // é o clique sem resposta que o Rica levava sem entender. Sobra o
          // Ligar, sozinho e de largura cheia — nunca quatro botões na linha.
          <button
            type="button"
            onClick={() => void acionarLigar()}
            aria-busy={ligar === 'enviando'}
            aria-label={descreveLigar(ligar)}
            className="ck-veil flex w-full items-center justify-center overflow-hidden border"
            style={{
              minHeight: 'var(--ck-touch-min)',
              padding: '0 var(--ck-space-2)',
              borderRadius: 'var(--ck-radius-frame)',
              borderColor: 'var(--ck-edge-functional)',
              fontSize: 'var(--ck-text-sm)',
              whiteSpace: 'nowrap',
              // Mesma régua dos outros: a PALAVRA muda junto com a cor (§3/§9.7).
              color: ligar === 'entregue' ? 'var(--ck-state-ok)' : 'var(--ck-text-primary)',
              transition: 'color var(--ck-dur-fast) var(--ck-ease)',
            }}
          >
            {rotulaLigar(ligar)}
          </button>
        ) : null}

        {carga === 'pronto' && (dePe || codex) ? (
          // Destravar + Resume + Desligar na MESMA linha — os três cabem lado a
          // lado (ordem do Rica, 03/08). Um debaixo do outro empurrava o resto do
          // painel pra baixo à toa; a ordem esquerda→direita continua sendo a
          // escada de custo: Escape não custa nada, relançar custa o turno em
          // voo, desligar tira o agente do ar. O Desligar ocupa o lugar exato
          // que era do Restart (10/08).
          <div className="flex" style={{ gap: 'var(--ck-space-2)' }}>
            {/* A linha "Fecha modal que travou o campo…" saiu por ordem do Rica
                (30/07): *"pode retirar os textos explicativos"*, citando-a pelo
                nome. Nada entrou no lugar — o que o botão faz continua dito no
                `aria-label`, que já existia e não é enfeite de tela. */}
            <button
                type="button"
                onClick={() => void acionarDestrava()}
                aria-busy={destrava === 'enviando'}
                // Estático só cobriria "Destravar": o nome acessível vence o
                // conteúdo, então o leitor de tela nunca ouviria "Destravando…"
                // nem "Escape enviado" — e no estado entregue o nome nem conteria
                // o texto visível (WCAG 2.5.3). Fora do ocioso o rótulo sozinho já
                // é a frase inteira.
                aria-label={
                  confirmaCompact && compactEmVoo
                    ? 'Confirmar? Destravar agora interrompe o resumo do compact — tocar de novo confirma'
                    : destrava === 'ocioso'
                      ? 'Destravar o agente — envia Escape 3x no terminal dele'
                      : rotulaDestrava(destrava)
                }
                className="ck-veil flex flex-1 items-center justify-center overflow-hidden border"
                style={{
                  minHeight: 'var(--ck-touch-min)',
                  padding: '0 var(--ck-space-2)',
                  borderRadius: 'var(--ck-radius-frame)',
                  borderColor: 'var(--ck-edge-functional)',
                  fontSize: 'var(--ck-text-sm)',
                  whiteSpace: 'nowrap',
                  // O recibo muda a PALAVRA, não só a cor: cor sozinha nunca é
                  // portadora de significado (§3/§9.7). A confirmação do compact
                  // entra na mesma régua — âmbar de atenção E outra frase.
                  color:
                    confirmaCompact && compactEmVoo
                      ? 'var(--ck-state-attention)'
                      : destrava === 'entregue'
                        ? 'var(--ck-state-ok)'
                        : 'var(--ck-text-primary)',
                  transition: 'color var(--ck-dur-fast) var(--ck-ease)',
                }}
              >
              {confirmaCompact && compactEmVoo ? 'Confirmar?' : rotulaDestrava(destrava)}
            </button>

            {/* RELANÇAR (com contexto) — o degrau acima do destrava. Quando o
                Escape não resolve porque o próprio Claude Code morreu, esta é a
                saída que não custa a conversa: sobe outro processo com
                `--resume`. Fica DEPOIS do destrava de propósito: a ordem na tela
                é a ordem em que se deve tentar. */}
            {!codex ? (
              <BotaoAcaoBruta
                fase={relancar}
                acao="resume"
                onClick={() => void acionarBruta('resume')}
              />
            ) : null}

            {/* DESLIGAR — o degrau mais bruto, no lugar exato que era do
                Restart. Não relança nada: encerra o agente e tudo que ele
                consome (processo, MCPs, o `bun` do canal), parando o cgroup
                inteiro da cerca da frota. A conversa fica — o Ligar retoma com
                `--continue`, então desligar não custa contexto. */}
            {!codex ? (
              <BotaoAcaoBruta
                fase={desligar}
                acao="desligar"
                onClick={() => void acionarBruta('desligar')}
              />
            ) : null}
          </div>
        ) : null}

        {avisoConfirmacao ? (
          // Largura cheia da gaveta (~348px), não o ~1/3 apertado de um botão —
          // é aqui que mora a frase que o rótulo curto do botão não conseguia
          // mostrar sem cortar (ver comentário de `avisoConfirmacao` acima).
          <p
            role="status"
            style={{
              fontSize: 'var(--ck-text-xs)',
              color: 'var(--ck-state-attention)',
            }}
          >
            {avisoConfirmacao}
          </p>
        ) : null}

        {falha ? (
          <div
            className="flex items-start justify-between"
            style={{ gap: 'var(--ck-space-3)' }}
            role="alert"
          >
            <span style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-state-attention)' }}>
              {falha.resumo} — {falha.saida}
            </span>
            <button
              type="button"
              onClick={() => setFalha(null)}
              aria-label="Dispensar aviso"
              className="ck-veil flex shrink-0 items-center justify-center"
              style={{
                minHeight: 'var(--ck-touch-min)',
                minWidth: 'var(--ck-touch-min)',
                borderRadius: 'var(--ck-radius-chip)',
                color: 'var(--ck-text-secondary)',
              }}
            >
              <IconeDescartar tamanho={13} />
            </button>
          </div>
        ) : null}
      </section>

      {/* Cota é leitura, não ação — irmã da região, nunca dentro dela. Só
          aparece com o painel lido: fabricar "sem dados" enquanto a busca está
          em voo ou caiu diria que o agente não reporta cota, quando o que caiu
          foi a rede. O recado da falha já está acima. */}
      {carga === 'pronto' ? <BlocoDeCota quotas={painel?.quotas} /> : null}
    </>
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
 * A nota sobre o rótulo `extra alto` quebrando em duas linhas morreu com o
 * esforço — e a premissa dela ("cinco níveis, ~69px") já tinha caducado antes:
 * a sexta opção derrubou o segmento para 54px no iPhone, e aí "extra alto"
 * empurrava a altura do trilho enquanto "máximo" encostava em "automático".
 * Sobraram permissão (3 rótulos, 4 em `acceptEdits`) e sandbox (3): 111px por
 * segmento, palavra inteira numa linha. **Segmentado horizontal com rótulo
 * longo em pt-BR não escala além de quatro** — um quinto degrau pede outra
 * forma, não mais uma coluna.
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
              // O rótulo sozinho ("Só planeja") é curto demais pra carregar a
              // explicação — soma os dois no nome acessível, rótulo primeiro
              // (2.5.3: o nome tem que CONTER o texto visível, nunca só a
              // descrição por baixo dele).
              aria-label={`${opcao.rotulo}. ${opcao.descricao}`}
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
