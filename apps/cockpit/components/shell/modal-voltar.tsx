'use client';

/**
 * O `/voltar` (Rica, 01/11): o rewind do Claude Code sem abrir o terminal.
 * Abre no lugar da bolha de comandos, com o fundo desfocado; primeiro a lista
 * dos pontos (rola, nasce no fim, o mais recente), depois — no mesmo modal —
 * as opções do ponto escolhido. Tocar numa opção é a confirmação: escolher o
 * ponto já foi o primeiro passo deliberado, e é o que o menu do CC também faz.
 * Lógica e frases em `lib/rewind.ts`.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import { fetchConversaOperacao } from '@grupo_borges/cockpit-core/api';

import {
  detalheDoErro,
  erroPedeReleitura,
  fraseDoErro,
  horaDoPonto,
  lerPontos,
  textoRestaurado,
  type AcaoDeVolta,
  type PontoDeVolta,
} from '../../lib/rewind';
import { TelaOpcoesVoltar } from './tela-opcoes-voltar';

export type ModalVoltarProps = {
  agentSlug: string;
  aberto: boolean;
  aoFechar: () => void;
  /** Sucesso: o texto do ponto volta pro composer pra ser editado e reenviado. */
  aoVoltar: (texto: string | null) => void;
  /** Pra onde o foco vai quando o modal some (fechado ou com sucesso). */
  aoDevolverFoco: () => void;
};

type Leitura =
  | { fase: 'carregando' }
  | { fase: 'falhou'; frase: string }
  | { fase: 'pronta'; pontos: PontoDeVolta[] };

export function ModalVoltar({ agentSlug, aberto, aoFechar, aoVoltar, aoDevolverFoco }: ModalVoltarProps) {
  const [leitura, setLeitura] = useState<Leitura>({ fase: 'carregando' });
  const [escolhido, setEscolhido] = useState<PontoDeVolta | null>(null);
  const [executando, setExecutando] = useState<AcaoDeVolta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [geracao, setGeracao] = useState(0);
  // A lista só desliza de volta quando vem das opções — na abertura quem se
  // move é a caixa, e dois movimentos juntos viram ruído.
  const [voltou, setVoltou] = useState(false);
  const listaRef = useRef<HTMLDivElement>(null);
  const caixaRef = useRef<HTMLDivElement>(null);
  // Onde a lista estava quando ele abriu um ponto: "voltar pra lista" devolve
  // ali, não no fim. `null` = primeira vez, nasce no mais recente.
  const rolagemRef = useRef<number | null>(null);
  const ultimoRef = useRef<string | null>(null);

  useEffect(() => {
    if (!aberto) return;
    const abortador = new AbortController();
    setLeitura({ fase: 'carregando' });
    void fetch(`/api/agents/${encodeURIComponent(agentSlug)}/rewind/pontos`, {
      cache: 'no-store',
      signal: abortador.signal,
    })
      .then(async (resposta) => {
        const corpo: unknown = await resposta.json().catch(() => null);
        if (!resposta.ok) throw new Error(detalheDoErro(corpo) ?? 'falhou');
        return lerPontos(corpo);
      })
      .then((pontos) => {
        if (!abortador.signal.aborted) setLeitura({ fase: 'pronta', pontos });
      })
      .catch((falha: unknown) => {
        if (abortador.signal.aborted) return;
        const detalhe = falha instanceof TypeError ? null : (falha as Error).message;
        setLeitura({
          fase: 'falhou',
          frase: detalhe === 'falhou' ? 'Não deu pra ler os pontos. Tente de novo.' : fraseDoErro(detalhe),
        });
      });
    return () => abortador.abort();
  }, [aberto, agentSlug, geracao]);

  // Fechou: tudo volta ao começo pra próxima abertura nascer na lista.
  useEffect(() => {
    if (aberto) return;
    setEscolhido(null);
    setErro(null);
    setExecutando(null);
    setVoltou(false);
    rolagemRef.current = null;
    ultimoRef.current = null;
  }, [aberto]);

  const pontos = leitura.fase === 'pronta' ? leitura.pontos : null;
  useLayoutEffect(() => {
    const lista = listaRef.current;
    if (!lista || escolhido || !pontos) return;
    lista.scrollTop = rolagemRef.current ?? lista.scrollHeight;
    // Voltando das opções, o foco volta pro ponto que ele tinha aberto.
    const anterior = ultimoRef.current;
    if (anterior) lista.querySelector<HTMLElement>(`[data-ponto="${CSS.escape(anterior)}"]`)?.focus({ preventScroll: true });
  }, [pontos, escolhido]);

  function abrirPonto(ponto: PontoDeVolta) {
    rolagemRef.current = listaRef.current?.scrollTop ?? null;
    ultimoRef.current = ponto.id;
    setErro(null);
    setEscolhido(ponto);
  }

  function voltarPraLista() {
    if (executando) return;
    setErro(null);
    setVoltou(true);
    setEscolhido(null);
  }

  async function executar(ponto: PontoDeVolta, acao: AcaoDeVolta) {
    if (executando) return;
    setExecutando(acao);
    setErro(null);
    try {
      const resposta = await fetch(`/api/agents/${encodeURIComponent(agentSlug)}/rewind`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ponto_id: ponto.id, acao }),
      });
      const corpo: unknown = await resposta.json().catch(() => null);
      if (resposta.status === 202) {
        // Mensagem do Telegram: a API copia a conversa e religa o agente,
        // o que passa dos 30 s do proxy. A etapa vem do `/conversas/operacao`.
        const erroDaOperacao = await esperarOperacao(agentSlug);
        if (erroDaOperacao !== null) setErro(fraseDoErro(erroDaOperacao));
        else aoVoltar(null);
        return;
      }
      if (!resposta.ok) {
        const detalhe = detalheDoErro(corpo) ?? `http_${resposta.status}`;
        setErro(fraseDoErro(detalhe));
        if (erroPedeReleitura(detalhe)) {
          setEscolhido(null);
          rolagemRef.current = null;
          ultimoRef.current = null;
          setGeracao((n) => n + 1);
        }
        return;
      }
      // O feed se relê sozinho pelo `session-reset` que o POST emite.
      aoVoltar(textoRestaurado(corpo));
    } catch {
      setErro(fraseDoErro(null));
    } finally {
      setExecutando(null);
    }
  }

  return (
    <Dialog.Root open={aberto} onOpenChange={(abrir) => !abrir && !executando && aoFechar()}>
      <Dialog.Portal>
        {/* Sem `Dialog.Overlay`: o véu é do composer (`.ck-composer-veu`), o
            mesmo da bolha, pra passagem bolha → modal não piscar. O toque fora
            continua fechando — quem escuta é o próprio `Dialog.Content`. */}
        <Dialog.Content
          ref={caixaRef}
          aria-describedby={undefined}
          className="ck-menu-surface ck-voltar"
          // Foco na caixa, não no primeiro item: o primeiro é o ponto MAIS
          // ANTIGO, e um anel de foco nele puxaria o olho pro lado errado.
          onOpenAutoFocus={(evento) => {
            evento.preventDefault();
            caixaRef.current?.focus();
          }}
          // Sem gatilho próprio (quem abriu foi a bolha), o Radix devolveria o
          // foco ao `body`. Tem de ser AQUI: um `requestAnimationFrame` do
          // composer roda antes do Radix soltar o foco e perde a disputa.
          onCloseAutoFocus={(evento) => {
            evento.preventDefault();
            aoDevolverFoco();
          }}
        >
          {escolhido ? (
            <TelaOpcoesVoltar
              key="opcoes"
              ponto={escolhido}
              executando={executando}
              erro={erro}
              aoRecuar={voltarPraLista}
              aoEscolher={(acao) => void executar(escolhido, acao)}
            />
          ) : (
            <div key="lista" className="ck-voltar-tela" data-lado="lista" data-voltou={voltou}>
              <div className="ck-voltar-cabeca">
                <Dialog.Title className="ck-voltar-titulo">Voltar até onde?</Dialog.Title>
              </div>
              {erro ? (
                <p role="alert" className="ck-voltar-erro">
                  {erro}
                </p>
              ) : null}
              <div ref={listaRef} className="ck-voltar-corpo ck-voltar-rola">
                {leitura.fase === 'carregando' ? (
                  <p role="status" className="ck-voltar-aviso">Lendo a conversa…</p>
                ) : null}
                {leitura.fase === 'falhou' ? (
                  <>
                    <p role="status" className="ck-voltar-aviso">{leitura.frase}</p>
                    <button
                      type="button"
                      className="ck-veil ck-voltar-item"
                      onClick={() => setGeracao((n) => n + 1)}
                    >
                      Tentar de novo
                    </button>
                  </>
                ) : null}
                {pontos?.length === 0 ? (
                  <p role="status" className="ck-voltar-aviso">
                    Nada pra voltar nesta conversa. Mensagem vinda do Telegram não vira ponto.
                  </p>
                ) : null}
                {pontos?.map((ponto) => (
                  <button
                    key={ponto.id}
                    type="button"
                    className="ck-veil ck-voltar-item"
                    data-ponto={ponto.id}
                    onClick={() => abrirPonto(ponto)}
                  >
                    <span className="ck-voltar-citacao min-w-0 flex-1">{ponto.texto}</span>
                    {ponto.arquivo_editado_depois ? (
                      <span className="ck-voltar-marca">
                        ±<span className="sr-only">, mexeu em arquivo depois</span>
                      </span>
                    ) : null}
                    <span className="ck-voltar-hora">{horaDoPonto(ponto.horario)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Espera a volta por cópia terminar. `null` = pronta; senão, o código do erro. */
async function esperarOperacao(agentSlug: string): Promise<string | null> {
  const prazo = Date.now() + 150_000;
  while (Date.now() < prazo) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const op = await fetchConversaOperacao(agentSlug);
      if (op.fase === 'erro') return op.detalhe ?? 'religar_falhou';
      if (op.fase === 'pronta' || op.fase === null) return null;
    } catch {
      // Rede oscilando: a operação segue no servidor, tenta de novo.
    }
  }
  return 'religar_falhou';
}
