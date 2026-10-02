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
 * API só tem a sentinela. Aqui só se desenha.
 *
 * DISCRETA É O DESENHO, NÃO O ALVO: o fio é hairline e o texto é `xs`, mas o
 * botão tem os 44px de altura da faixa — a mesma lição da cápsula (§3 da
 * estética). Em tela estreita ela CEDE primeiro (`min-width: 0` + truncar);
 * quem não pode encolher é a cápsula do agente.
 *
 * UM MOVIMENTO SÓ, e ele responde ao dedo: o campo entra no lugar da pílula.
 * Sem deslocamento, sem mola — só a opacidade, curta, e sob
 * `MotionConfig reducedMotion="user"`.
 *
 * O salvar é o MESMO da gaveta (`postConversaTitulo`, pela função do módulo);
 * não há segunda rota de escrita para o título. Vazio apaga o nome dado e a
 * conversa volta ao automático — mesma regra do rodapé da leitura.
 */
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';

import { renomeiaConversaEmUso, usaConversaEmUso } from '@/lib/conversa-em-uso';

/** Quanto o aviso de falha fica na pílula antes de o nome voltar. */
const RECIBO_MS = 4_000;

/** A transição do campo: curta e só de opacidade — a pílula não desliza. */
const TROCA = { duration: 0.14, ease: 'easeOut' } as const;

/** O teto da pílula em 375px: ela nunca passa de 45% da faixa — o resto é do
 *  agente. Título maior que isso trunca, e truncar é o certo aqui: empurrar a
 *  cápsula para fora da tela seria perder o controle que abre a gaveta. */
const CAIXA: CSSProperties = {
  minHeight: 'var(--ck-touch-min)',
  maxWidth: 'min(45vw, 280px)',
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
};

const DESENHO: CSSProperties = {
  minWidth: 0,
  padding: '2px 10px',
  borderRadius: 'var(--ck-radius-pill)',
  border: '1px solid var(--ck-edge-hairline)',
  fontSize: 'var(--ck-text-xs)',
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

export function PilulaDaConversa({ agentSlug }: { agentSlug: string }) {
  const emUso = usaConversaEmUso(agentSlug);
  const [editando, setEditando] = useState(false);
  const [titulo, setTitulo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const recibo = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    setAviso(null);
    setTitulo(emUso.nova ? '' : emUso.rotulo);
    setEditando(true);
  };

  const cancela = () => {
    if (salvando) return;
    setEditando(false);
    setTitulo('');
  };

  const salva = () => {
    if (salvando) return;
    setSalvando(true);
    renomeiaConversaEmUso(agentSlug, emUso.id, titulo.trim())
      .then(() => {
        setEditando(false);
        setTitulo('');
      })
      .catch(() => {
        // O nome não mudou. Dizer isso na própria pílula é mais honesto que
        // fechar o campo em silêncio — e o nome que fica é o de antes.
        setEditando(false);
        setAviso('Não renomeei');
        if (recibo.current) clearTimeout(recibo.current);
        recibo.current = setTimeout(() => setAviso(null), RECIBO_MS);
      })
      .finally(() => setSalvando(false));
  };

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence initial={false}>
        {editando ? (
          <motion.form
            key="campo"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={TROCA}
            style={CAIXA}
            onSubmit={(e) => {
              e.preventDefault();
              salva();
            }}
          >
            <input
              autoFocus
              value={titulo}
              maxLength={200}
              onChange={(e) => setTitulo(e.target.value)}
              onBlur={cancela}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  cancela();
                }
              }}
              aria-label="Nome da conversa"
              placeholder="Nome da conversa"
              className="ck-veil bg-transparent outline-none"
              style={{
                ...DESENHO,
                width: 'clamp(120px, 30vw, 220px)',
                color: 'var(--ck-text-primary)',
              }}
            />
          </motion.form>
        ) : (
          <motion.button
            key="pilula"
            type="button"
            onClick={abre}
            aria-label={`Renomear a conversa ${emUso.rotulo}`}
            className="ck-veil"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={TROCA}
            style={{ ...CAIXA, background: 'transparent', color: 'var(--ck-text-secondary)' }}
          >
            <span style={DESENHO}>{aviso ?? emUso.rotulo}</span>
          </motion.button>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}
