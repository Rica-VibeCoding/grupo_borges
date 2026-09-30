'use client';

import { useEffect, useRef, useState, type SyntheticEvent } from 'react';

import { postAgentLigar } from '@grupo_borges/cockpit-core/api';

import { diagnosticaCicloDeVida, leiaLigar } from '../shell/acoes-rapidas';
import styles from './botao-ligar.module.css';

/** O boot leva 13 a 15 s (`ESPERAS_APOS_LIGAR_MS`); passou disso com folga, o botão volta. */
export const PRAZO_DO_BOOT_MS = 30_000;

// O botão mora por cima do toque da tela: o dedo nele não inicia conversa nem gesto.
const fica = (evento: SyntheticEvent) => evento.stopPropagation();

/**
 * O Ligar do painel, na tela de voz do agente desligado (Rica, 30/09: "o mesmo botão ligar
 * apenas, bem minimalista"). Mesma rota e mesma leitura da resposta do `bloco-de-acoes.tsx`.
 * Sem confirmação: subir não destrói nada. Quem diz que subiu é a frota ao vivo — o
 * `offline` some, a tela troca de cena e este botão desmonta.
 */
export function BotaoLigar({ slug }: { slug: string }) {
  const [ligando, setLigando] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);
  const prazo = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(prazo.current ?? undefined), []);

  async function liga(evento: SyntheticEvent) {
    evento.stopPropagation();
    if (ligando) return;
    setFalha(null);
    setLigando(true);
    try {
      const aviso = leiaLigar(await postAgentLigar(slug));
      if (aviso) setFalha(aviso.resumo);
      prazo.current = setTimeout(() => {
        setLigando(false);
        setFalha((atual) => atual ?? 'ainda não subiu — confira no painel');
      }, PRAZO_DO_BOOT_MS);
    } catch (erro) {
      setLigando(false);
      setFalha(diagnosticaCicloDeVida(erro, 'ligar').resumo);
    }
  }

  return (
    <div className={styles.lugar}>
      <button
        type="button"
        className={styles.botao}
        data-ligando={ligando ? '' : undefined}
        aria-busy={ligando}
        onClick={liga}
        onPointerDown={fica}
        onPointerUp={fica}
      >
        {ligando ? 'Ligando…' : 'Ligar'}
      </button>
      {falha ? (
        <p role="alert" className={styles.falha}>
          {falha}
        </p>
      ) : null}
    </div>
  );
}
