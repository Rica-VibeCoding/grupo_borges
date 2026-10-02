'use client';

/**
 * A pílula da conversa — o nome do que está aberto agora, ao lado do agente.
 *
 * Pedido do Rica (02/10): *"ao lado do nome do agente, uma pílula discreta com
 * o nome da conversa em uso"*. Ela é IRMÃ da cápsula, nunca filha: a cápsula
 * abre a gaveta, e a pílula recebe o dedo para outra coisa — uma dentro da
 * outra, a segunda roubaria o toque da primeira.
 *
 * A RÉGUA DO NOME mora em `lib/conversa-em-uso.ts` (pura, com teste): o nome
 * dado pelo Rica, o automático da primeira fala, ou "Conversa nova" enquanto a
 * API só tem a sentinela. Aqui só se desenha — e o desenho mora no
 * `.module.css` ao lado, só com token.
 *
 * MESMA FAMÍLIA DA CÁPSULA: o vidro escuro da pílula do agente, sem desfoque,
 * em escala menor. Discreta é o desenho, não o alvo: o botão tem os 44px da
 * faixa. Em tela estreita ela CEDE primeiro (base 0 + truncar); quem não pode
 * encolher é a cápsula.
 *
 * O CAMPO ABRE POR CIMA, ancorado no vão entre a cápsula e a pílula de tokens.
 * A pílula fica no lugar, invisível, segurando a largura — renomear não reflui
 * a faixa nem empurra ninguém para fora em 375px.
 *
 * MOVIMENTO É O `.ck-surge` (§5): as duas peças vivem montadas e alternam
 * `data-aberto`, porque elemento removido não anima a saída. Por isso o foco do
 * campo é à mão, DENTRO do toque (`flushSync` + `focus()`): foco dado depois,
 * num efeito, o Safari do iPhone recusa abrir o teclado.
 *
 * O salvar é o MESMO da gaveta (`postConversaTitulo`, pela função do módulo);
 * não há segunda rota de escrita para o título. Vazio apaga o nome dado e a
 * conversa volta ao automático — mesma regra do rodapé da leitura.
 */
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { renomeiaConversaEmUso, usaConversaEmUso } from '@/lib/conversa-em-uso';

import styles from './pilula-da-conversa.module.css';

/** Quanto o aviso de falha fica na pílula antes de o nome voltar. */
const RECIBO_MS = 4_000;

export function PilulaDaConversa({ agentSlug }: { agentSlug: string }) {
  const emUso = usaConversaEmUso(agentSlug);
  const [editando, setEditando] = useState(false);
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
  // cockpit não lê). Com ela fora, o campo aberto não teria em quê escrever:
  // fecha. Sem isto o Enter cairia no vazio.
  useEffect(() => {
    if (!emUso) setEditando(false);
  }, [emUso]);

  if (!emUso) return null;

  const abre = () => {
    if (recibo.current) clearTimeout(recibo.current);
    flushSync(() => {
      setAviso(null);
      setTitulo(emUso.nova ? '' : emUso.rotulo);
      setEditando(true);
    });
    campo.current?.focus();
    campo.current?.select();
  };

  /** Fecha o campo. Pelo teclado (Enter, Esc) o foco volta à pílula; pelo
   *  toque fora, fica onde o dedo foi. */
  const fecha = (devolveFoco: boolean) => {
    // A pílula só aceita foco depois de visível: o `flushSync` aplica o
    // `data-aberto` antes do `focus()`.
    flushSync(() => {
      setEditando(false);
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
        // fechar o campo em silêncio — e o nome que fica é o de antes.
        fecha(true);
        setAviso('Não renomeei');
        if (recibo.current) clearTimeout(recibo.current);
        recibo.current = setTimeout(() => setAviso(null), RECIBO_MS);
      })
      .finally(() => setSalvando(false));
  };

  return (
    <div className={styles.lugar}>
      <button
        ref={botao}
        type="button"
        onClick={abre}
        aria-label={`Renomear a conversa ${emUso.rotulo}`}
        data-aberto={String(!editando)}
        className={`ck-surge ${styles.alvo}`}
      >
        <span className={styles.nome} data-falhou={aviso !== null} aria-live="polite">
          {aviso ?? emUso.rotulo}
        </span>
      </button>

      <form
        data-aberto={String(editando)}
        className={`ck-surge ${styles.campo}`}
        onSubmit={(e) => {
          e.preventDefault();
          salva();
        }}
      >
        <input
          ref={campo}
          value={titulo}
          maxLength={200}
          tabIndex={editando ? 0 : -1}
          readOnly={salvando}
          aria-busy={salvando}
          onChange={(e) => setTitulo(e.target.value)}
          onBlur={() => cancela(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              cancela(true);
            }
          }}
          aria-label="Nome da conversa"
          placeholder="Nome da conversa"
          enterKeyHint="done"
          className={`ck-campo ${styles.entrada}`}
        />
      </form>
    </div>
  );
}
