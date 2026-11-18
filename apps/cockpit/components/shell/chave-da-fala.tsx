'use client';

/**
 * A CHAVE DO DANIEL: "Ted fala" × "Ted fica quieto" (Rica, 18/11). Som que
 * chega sem aviso pode incomodar criança autista — então o controle é dele,
 * grande, sempre à vista acima da caixa, e lembrado entre aberturas
 * (`usa-fala-sozinha.ts`). Só existe no agente que fala sozinho.
 *
 * O texto é o ESTADO ("Ted fala"), não a ação: é o que uma criança lê como
 * "agora está assim". Para leitor de tela é um `switch` — o estado vai no
 * `aria-checked` e o nome é a frase visível.
 *
 * Movimento só no toque: o ícone novo entra numa mola curta. Com
 * `prefers-reduced-motion` o `MotionConfig` do composer corta a escala.
 */
import { AnimatePresence, motion } from 'motion/react';

import { destravaFalaSozinha, useFalaLigada } from '../feed/usa-fala-sozinha';
import { IconeAltoFalanteCalado, IconeAltoFalanteFala } from './icones';

export function ChaveDaFala({ agentSlug, agentName }: { agentSlug: string; agentName: string }) {
  const [ligada, muda] = useFalaLigada(agentSlug);
  return (
    <div className="flex justify-end">
      <button
        type="button"
        role="switch"
        aria-checked={ligada}
        onClick={() => {
          muda(!ligada);
          // Ligar é gesto: já deixa o áudio destravado para a próxima resposta.
          if (!ligada) destravaFalaSozinha(agentSlug);
        }}
        className="ck-veil flex items-center"
        style={{
          gap: 'var(--ck-space-2)',
          minHeight: 'var(--ck-touch-min)',
          padding: '0 var(--ck-space-4) 0 var(--ck-space-3)',
          borderRadius: 'var(--ck-radius-pill)',
          border: '1px solid var(--ck-edge-composer)',
          background: 'var(--ck-surface-composer)',
          color: ligada ? 'var(--ck-text-primary)' : 'var(--ck-text-secondary)',
          fontSize: 'var(--ck-text-md)',
          transition: 'color var(--ck-dur-fast) var(--ck-ease)',
        }}
      >
        <span className="grid size-[22px] place-items-center" aria-hidden>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={ligada ? 'fala' : 'quieto'}
              className="grid place-items-center"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={{ type: 'spring', bounce: 0.22, visualDuration: 0.25 }}
            >
              {ligada ? <IconeAltoFalanteFala tamanho={22} /> : <IconeAltoFalanteCalado tamanho={22} />}
            </motion.span>
          </AnimatePresence>
        </span>
        {ligada ? `${agentName} fala` : `${agentName} fica quieto`}
      </button>
    </div>
  );
}
