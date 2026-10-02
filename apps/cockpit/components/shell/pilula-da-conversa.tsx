'use client';

/**
 * A pílula da conversa — o nome do que está aberto agora, ao lado do agente.
 *
 * Pedido do Rica (02/10): *"ao lado do nome do agente, uma pílula discreta com
 * o nome da conversa em uso"*. Ela é IRMÃ da cápsula, nunca filha: a cápsula
 * abre a gaveta, e a pílula recebe o dedo para outra coisa — uma dentro da
 * outra, a segunda roubaria o toque da primeira.
 *
 * A RÉGUA DO NOME e a da LINHA DO CARTÃO moram em `lib/conversa-em-uso.ts`
 * (puras, com teste). Aqui só se desenha — e o desenho mora no `.module.css`
 * ao lado, só com token.
 *
 * O TOQUE ABRE UM CARTÃO (02/10): o campo do nome em cima e, embaixo, quando a
 * conversa começou e quantos turnos tem. O cartão é superfície flutuante (§8):
 * o `Popover` de `components/ui/`, que já veste `.ck-menu-surface` — o escuro
 * da cápsula, opaco — e abre por cima do feed, sem refluir a faixa. Em 375px o
 * Radix o empurra para dentro da tela; a pílula fica onde está.
 *
 * FOCO NO IPHONE: o campo recebe foco DENTRO do toque (`flushSync` + `focus()`),
 * e o foco automático do Radix fica desligado — ele foca num efeito, depois do
 * gesto, e aí o Safari do iPhone não abre o teclado.
 *
 * Enter salva; Esc e toque fora fecham sem salvar. O salvar é o MESMO da gaveta
 * (`postConversaTitulo`, pela função do módulo). Vazio apaga o nome dado e a
 * conversa volta ao automático — mesma regra do rodapé da leitura.
 */
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { linhaDaConversa, renomeiaConversaEmUso, usaConversaEmUso } from '@/lib/conversa-em-uso';

import { Popover, PopoverAnchor, PopoverContent } from '../ui/popover';
import styles from './pilula-da-conversa.module.css';

/** Quanto o aviso de falha fica na pílula antes de o nome voltar. */
const RECIBO_MS = 4_000;

export function PilulaDaConversa({ agentSlug }: { agentSlug: string }) {
  const emUso = usaConversaEmUso(agentSlug);
  const [aberto, setAberto] = useState(false);
  const [titulo, setTitulo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const recibo = useRef<ReturnType<typeof setTimeout> | null>(null);
  const campo = useRef<HTMLInputElement>(null);
  const botao = useRef<HTMLButtonElement>(null);

  useEffect(
    () => () => {
      if (recibo.current) clearTimeout(recibo.current);
    },
    [],
  );

  // A pílula some quando a lista não aponta conversa nenhuma (motor que o
  // cockpit não lê). Com ela fora, o cartão não teria em quê escrever: fecha.
  useEffect(() => {
    if (!emUso) setAberto(false);
  }, [emUso]);

  if (!emUso) return null;

  const linha = linhaDaConversa(emUso);

  const abre = () => {
    if (recibo.current) clearTimeout(recibo.current);
    flushSync(() => {
      setAviso(null);
      setTitulo(emUso.nova ? '' : emUso.rotulo);
      setAberto(true);
    });
    campo.current?.focus({ preventScroll: true });
    campo.current?.select();
  };

  /** Fecha o cartão. Pelo teclado (Enter, Esc) o foco volta à pílula; pelo
   *  toque fora, fica onde o dedo foi. */
  const fecha = (devolveFoco: boolean) => {
    flushSync(() => {
      setAberto(false);
      setTitulo('');
    });
    if (devolveFoco) botao.current?.focus({ preventScroll: true });
  };

  const cancela = (devolveFoco: boolean) => {
    if (!salvando) fecha(devolveFoco);
  };

  const salva = () => {
    if (salvando) return;
    setSalvando(true);
    renomeiaConversaEmUso(agentSlug, emUso.id, titulo.trim())
      .then(() => fecha(true))
      .catch(() => {
        // O nome não mudou. Dizer isso na própria pílula é mais honesto que
        // fechar o cartão em silêncio — e o nome que fica é o de antes.
        fecha(true);
        setAviso('Não renomeei');
        if (recibo.current) clearTimeout(recibo.current);
        recibo.current = setTimeout(() => setAviso(null), RECIBO_MS);
      })
      .finally(() => setSalvando(false));
  };

  return (
    <Popover open={aberto} onOpenChange={(abrir) => (abrir ? abre() : cancela(false))}>
      <div className={styles.lugar}>
        <PopoverAnchor asChild>
          <button
            ref={botao}
            type="button"
            onClick={() => (aberto ? cancela(true) : abre())}
            aria-label={`Conversa ${emUso.rotulo} — renomear`}
            aria-haspopup="dialog"
            aria-expanded={aberto}
            className={styles.alvo}
          >
            <span className={styles.nome} data-aberto={aberto} data-falhou={aviso !== null} aria-live="polite">
              {aviso ?? emUso.rotulo}
            </span>
          </button>
        </PopoverAnchor>
      </div>

      <PopoverContent
        side="bottom"
        align="start"
        // A âncora é o alvo de 44px, não o desenho da pílula: a folga entre os
        // dois já separa o cartão da pílula. Mais 8px o descolaria dela.
        sideOffset={0}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          cancela(true);
        }}
        // A pílula é a âncora, não o gatilho do Radix: o toque nela conta como
        // "fora". Sem isto o cartão fecharia no `pointerdown` e reabriria no clique.
        onInteractOutside={(e) => {
          if (botao.current?.contains(e.target as Node)) e.preventDefault();
        }}
        aria-label="Conversa em uso"
        className={`ck-menu-surge ${aberto ? 'ck-menu-aberto' : 'ck-menu-fechado'} ${styles.cartao}`}
        style={{ transformOrigin: 'var(--radix-popover-content-transform-origin)' }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            salva();
          }}
        >
          <input
            ref={campo}
            value={titulo}
            maxLength={200}
            readOnly={salvando}
            aria-busy={salvando}
            onChange={(e) => setTitulo(e.target.value)}
            aria-label="Nome da conversa"
            placeholder="Nome da conversa"
            enterKeyHint="done"
            className={`ck-campo ${styles.entrada}`}
          />
        </form>
        {linha ? <p className={`ck-tabular ${styles.linha}`}>{linha}</p> : null}
      </PopoverContent>
    </Popover>
  );
}
