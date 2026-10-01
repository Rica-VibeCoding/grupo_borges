'use client';

/**
 * O HISTÓRICO — terceira visão da gaveta (`?painel=conversas`; F9, F10 e a
 * rodada 2 das conversas, protótipo aprovado pelo Rica em 01/10).
 *
 * Duas camadas no mesmo lugar: a LISTA (só título e tempo) e a LEITURA de uma
 * conversa, que abre por cima com o `.ck-surge` e cujo título é o da linha
 * tocada (`layoutId`). Olhar não é trocar: quem troca é o Continuar esta, no
 * rodapé da leitura. As duas ficam montadas e alternam `data-aberto` (§5:
 * elemento removido não anima a saída).
 *
 * Enquanto a leitura está aberta, a lista fica CONGELADA nas linhas que tinha:
 * o que muda lá dentro (Concluída, 🗑, ⭐ tirada no filtro ⭐) só tira a linha
 * depois da volta, para a saída dela ser vista.
 *
 * Ocupado vem da frota ao vivo; desligado e motor religando, do `usaVidaDoAgente`.
 * A API é a palavra final: um 409 `ocupado` deixa o botão âmbar.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MotionConfig, motion } from 'motion/react';

import { postConversaConcluida, postConversaEstrela, postConversaTitulo, type Conversa } from '@grupo_borges/cockpit-core/api';

import { usaFrota } from '../shell/frota-provider';
import { LinkFechaPainel } from '../shell/superficie-otimista';
import { LinkDaGaveta } from '../shell/vista-da-gaveta';
import { AvisoDeFalha, BarraDeEspera } from './acao-de-conversa';
import { ATUAL, ondeMostra, textoDaEspera, trocaEmCurso } from './acoes-de-conversa';
import { CartaoEmUso } from './cartao-em-uso';
import { filtraConversas, mostraEmUso, separaAtual, type FiltroDeConversa } from './conversas';
import { LeituraDoHistorico } from './leitura-do-historico';
import { ListaDoHistorico } from './lista-do-historico';
import { Bloco, Pilula } from './pecas';
import { ESPERA_DA_VOLTA_MS } from './ritmo-do-historico';
import { RodapeDaLeitura } from './rodape-da-leitura';
import { usaAcoesDeConversa } from './usa-acoes-de-conversa';
import { usaListaDoHistorico } from './usa-lista-do-historico';
import { usaVidaDoAgente } from './usa-vida-do-agente';

const ALVO_DO_CABECALHO = { minWidth: 'var(--ck-touch-min)', minHeight: 'var(--ck-touch-min)', borderRadius: 'var(--ck-radius-chip)', fontSize: 'var(--ck-text-lg)', color: 'var(--ck-text-secondary)' } as const;
const VOLTAR_AO_CHAT = { minHeight: '48px', borderRadius: 'var(--ck-gv-raio-bloco)', fontSize: 'var(--ck-text-sm)', fontWeight: 600, background: 'var(--ck-gv-ativo)', color: 'var(--ck-text-primary)' } as const;
const CAMADA = { gridArea: '1 / 1', gap: 'var(--ck-space-2)' } as const;
const erroDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function PainelDeConversas({ agentSlug, fecharHref }: { agentSlug: string; fecharHref: string }) {
  const { agents } = usaFrota();
  const nomeDoAgente = useCallback((slug: string) => agents.find((a) => a.slug === slug)?.name ?? slug, [agents]);
  const nome = nomeDoAgente(agentSlug);
  const ocupado = agents.find((a) => a.slug === agentSlug)?.status === 'trabalhando';
  const vida = usaVidaDoAgente(agentSlug, false);
  const { carga, concluidas, ler, lerConcluidas, muda, tira } = usaListaDoHistorico(agentSlug);
  const [filtro, setFiltro] = useState<FiltroDeConversa>('todas');
  const [busca, setBusca] = useState('');
  const [aberta, setAberta] = useState<string | null>(null);
  const [congelada, setCongelada] = useState<string[] | null>(null);
  const [falha, setFalha] = useState<{ id: string; texto: string } | null>(null);

  const lista = carga.fase === 'pronto' ? carga.dados.conversas : [];
  const { atual, outras } = useMemo(() => separaAtual(lista), [lista]);
  const fonte = filtro === 'concluidas' ? (concluidas?.fase === 'pronto' ? concluidas.dados.conversas : []) : outras;
  const visiveis = useMemo(() => filtraConversas(fonte, filtro, busca), [fonte, filtro, busca]);

  // Toda conversa já vista fica guardada: a lista congelada e a leitura que
  // está saindo seguem desenhando uma conversa que acabou de ser excluída.
  const vistas = useRef(new Map<string, Conversa>());
  for (const c of lista) vistas.current.set(c.id, c);
  if (concluidas?.fase === 'pronto') for (const c of concluidas.dados.conversas) vistas.current.set(c.id, c);
  const [exibida, setExibida] = useState<string | null>(null);
  const vista = exibida ? (vistas.current.get(exibida) ?? null) : null;
  const linhas = congelada ? congelada.flatMap((id) => vistas.current.get(id) ?? []).filter((c) => !c.atual) : visiveis;

  const fechaLeitura = useCallback(() => {
    setAberta(null);
    setFalha(null);
    setTimeout(() => setCongelada(null), ESPERA_DA_VOLTA_MS);
  }, []);

  const { buscar: relePainel } = vida;
  const acoes = usaAcoesDeConversa({
    agentSlug,
    nome,
    atual: carga.fase === 'pronto' ? (atual?.id ?? null) : undefined,
    releLista: () => ler(undefined, true),
    aoMudarLinha: () => {
      ler(undefined, true);
      relePainel();
    },
    tituloDe: (id) => vistas.current.get(id)?.titulo ?? null,
    aoExcluir: (id) => {
      tira(id);
      fechaLeitura();
    },
  });

  // A troca deu certo: a conversa virou a de agora e sai da lista; a leitura
  // fecha e o cartão de cima diz "Retomada agora" com o caminho do chat.
  const { trocouAgora } = acoes;
  useEffect(() => {
    if (trocouAgora) fechaLeitura();
  }, [trocouAgora, fechaLeitura]);

  const onde = ondeMostra(acoes.estado);
  const noTopo = onde !== null && (onde === ATUAL || onde !== aberta);
  const emTroca = trocaEmCurso(acoes.estado);
  const podeTrocar = !emTroca && !vida.aplicandoMotor && acoes.estado.fase !== 'excluindo';
  const porQueNao = vida.aplicandoMotor ? 'O motor está sendo trocado. Continuar volta quando ele religar.' : emTroca ? 'Há uma troca de conversa em andamento.' : null;
  const dePe = vida.carga === 'pronto' ? vida.dePe : true;
  const recusou = (tipo: 'retomar' | 'nova', id: string | null) =>
    acoes.estado.fase === 'ocupado' && acoes.estado.troca.tipo === tipo && acoes.estado.troca.alvo === id;
  const suportado = carga.fase === 'pronto' && carga.dados.suportado;
  const agora = carga.fase === 'pronto' ? carga.lidaEm : 0;

  const estado = acoes.estado;
  const acaoNoTopo = !noTopo ? null : estado.fase === 'esperando' || estado.fase === 'conferindo' ? (
    <BarraDeEspera texto={textoDaEspera(estado.troca, nome)} />
  ) : estado.fase === 'falhou' ? (
    <AvisoDeFalha texto={estado.texto} aoFechar={acoes.larga} />
  ) : null;

  function abre(c: Conversa) {
    acoes.larga();
    setFalha(null);
    setCongelada(linhas.map((x) => x.id));
    setExibida(c.id);
    setAberta(c.id);
  }

  function escolheFiltro(f: FiltroDeConversa) {
    if (f === 'concluidas') lerConcluidas();
    setFiltro(f);
  }

  /** ⭐ e Concluída são otimistas: viram na hora e desviram se a API recusar. */
  function marca(c: Conversa, campos: Partial<Conversa>, envia: () => Promise<unknown>, rotulo: string) {
    const antes = Object.fromEntries(Object.keys(campos).map((k) => [k, c[k as keyof Conversa]])) as Partial<Conversa>;
    muda(c, campos);
    setFalha(null);
    return envia().catch((e: unknown) => {
      muda({ ...c, ...campos }, antes);
      setFalha({ id: c.id, texto: `${rotulo}: ${erroDe(e)}` });
      throw e;
    });
  }

  const leituraInterrompe = vista ? dePe && (ocupado || recusou('retomar', vista.id)) : false;

  return (
    <MotionConfig reducedMotion="user">
      <div className="ck-gv flex min-h-0 flex-auto flex-col" style={{ gap: 'var(--ck-space-2)', padding: 'var(--ck-space-3)' }}>
        <header className="flex shrink-0 items-center" style={{ gap: 'var(--ck-space-1)', minHeight: '48px' }}>
          {aberta ? (
            <button type="button" onClick={fechaLeitura} aria-label="Voltar para a lista" className="ck-veil flex items-center justify-center" style={ALVO_DO_CABECALHO}>
              ‹
            </button>
          ) : (
            <LinkDaGaveta href={`${fecharHref}?painel=detalhes`} aria-label="Voltar para a gaveta do agente" className="ck-veil flex items-center justify-center" style={ALVO_DO_CABECALHO}>
              ‹
            </LinkDaGaveta>
          )}
          <h2 className="min-w-0 flex-1 truncate" style={{ fontSize: 'var(--ck-text-md)', fontWeight: 600, color: 'var(--ck-text-primary)' }}>
            Histórico
          </h2>
          <LinkFechaPainel href={fecharHref} rotulo="detalhes do agente" className="ck-veil flex items-center justify-center" style={ALVO_DO_CABECALHO}>
            ×
          </LinkFechaPainel>
        </header>

        <div className="grid min-h-0 flex-auto" style={{ gridTemplateRows: 'minmax(0, 1fr)' }}>
          <motion.div layoutScroll data-aberto={String(!aberta)} className="ck-surge flex min-h-0 flex-col overflow-y-auto" style={CAMADA}>
            {carga.fase === 'falhou' ? (
              <Bloco>
                <p role="alert" style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-state-attention)' }}>
                  Não consegui ler as conversas: {carga.motivo}
                </p>
                <div className="flex">
                  <Pilula aoTocar={() => ler()}>Tentar de novo</Pilula>
                </div>
              </Bloco>
            ) : null}

            {carga.fase === 'pronto' && !carga.dados.suportado ? (
              <Bloco>
                <p role="status" style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}>
                  O motor deste agente não guarda conversas que o cockpit saiba ler.
                </p>
              </Bloco>
            ) : null}

            {/* A troca que voltou de um recarregar aparece mesmo antes da lista chegar. */}
            {(suportado || acaoNoTopo) && mostraEmUso(atual, acaoNoTopo !== null || trocouAgora !== null) ? (
              <CartaoEmUso
                atual={atual}
                dePe={dePe}
                acao={acaoNoTopo}
                trocouAgora={estado.fase === 'livre' ? trocouAgora : null}
                voltar={
                  <LinkFechaPainel href={fecharHref} rotulo="o Histórico e voltar ao chat" className="ck-veil flex items-center justify-center" style={VOLTAR_AO_CHAT}>
                    Voltar ao chat
                  </LinkFechaPainel>
                }
              />
            ) : null}

            {carga.fase === 'carregando' || suportado ? (
              <ListaDoHistorico
                linhas={linhas}
                carregando={carga.fase === 'carregando' || (filtro === 'concluidas' && concluidas?.fase === 'carregando')}
                agora={agora}
                filtro={filtro}
                escolheFiltro={escolheFiltro}
                busca={busca}
                mudaBusca={setBusca}
                aoAbrir={abre}
              />
            ) : null}
          </motion.div>

          <div data-aberto={String(aberta !== null)} aria-hidden={aberta === null} className="ck-surge flex min-h-0 flex-col" style={CAMADA}>
            {vista ? (
              <LeituraDoHistorico
                key={vista.id}
                agentSlug={agentSlug}
                conversa={vista}
                agora={agora}
                lider={aberta === vista.id}
                nomeDoAgente={nomeDoAgente}
                rodape={
                  <RodapeDaLeitura
                    conversa={vista}
                    estado={estado}
                    nome={nome}
                    interrompe={leituraInterrompe}
                    podeTrocar={podeTrocar}
                    porQueNao={porQueNao}
                    falha={falha?.id === vista.id ? falha.texto : null}
                    aoContinuar={() => acoes.pedeRetomar(vista.id, { ocupado: leituraInterrompe, desligado: !dePe })}
                    aoEstrela={() => void marca(vista, { estrela: !vista.estrela }, () => postConversaEstrela(agentSlug, vista.id, !vista.estrela), 'A estrela não ficou').catch(() => {})}
                    aoConcluida={() =>
                      void marca(vista, { concluida: !vista.concluida }, () => postConversaConcluida(agentSlug, vista.id, !vista.concluida), 'A marca não ficou')
                        .then(fechaLeitura)
                        .catch(() => {})
                    }
                    aoRenomear={async (titulo) => {
                      const r = await postConversaTitulo(agentSlug, vista.id, titulo);
                      muda(vista, { titulo: r.titulo, titulo_origem: r.titulo_origem });
                    }}
                    aoExcluir={() => acoes.pedeExclusao(vista.id)}
                    aoConfirmar={acoes.confirma}
                    aoLargar={acoes.larga}
                    aoFecharFalha={() => setFalha(null)}
                  />
                }
              />
            ) : null}
          </div>
        </div>
      </div>
    </MotionConfig>
  );
}
