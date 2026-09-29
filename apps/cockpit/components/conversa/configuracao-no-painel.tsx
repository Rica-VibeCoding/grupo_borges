'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';

import { useDetalheDaConversa } from './contexto-configuracao-conversa';
import { ControlesDaConversa } from './controles-da-conversa';
import { mostraConversaNoPainel } from './conversa-no-painel';
import styles from './configuracao-no-painel.module.css';
import { CHAVE_FONE, CHAVE_TEXTO } from './preferencias-da-conversa';
import { useChaveDaConversa, useDirecaoDaVoz, useVisualConversa } from './use-preferencias-conversa';

function SecaoConversa({ fechar }: { fechar: ReactNode }) {
  const [visual, escolheVisual] = useVisualConversa();
  const [direcao, escolheDirecao] = useDirecaoDaVoz();
  const [fone, mudaFone] = useChaveDaConversa(CHAVE_FONE);
  const [texto, mudaTexto] = useChaveDaConversa(CHAVE_TEXTO);
  const detalheTecnico = useDetalheDaConversa();

  return (
    <section className={styles.conversa} aria-label="Conversa">
      <header className={styles.cabecalho}>
        <div>
          <h2>Conversa</h2>
          <p>Ficam guardadas neste aparelho.</p>
        </div>
        <div className={styles.fechar}>{fechar}</div>
      </header>
      <ControlesDaConversa
        visual={visual}
        escolheVisual={escolheVisual}
        direcao={direcao}
        escolheDirecao={escolheDirecao}
        fone={fone}
        mudaFone={mudaFone}
        texto={texto}
        mudaTexto={mudaTexto}
        detalheTecnico={detalheTecnico}
      />
    </section>
  );
}

export function ConfiguracaoNoPainel({ children, fechar }: { children: ReactNode; fechar: ReactNode }) {
  const caminho = usePathname() ?? '';
  const busca = useSearchParams()?.toString() ?? '';
  if (!mostraConversaNoPainel(caminho, busca)) return children;
  return (
    <div className={styles.mescla}>
      <SecaoConversa fechar={fechar} />
      <div className={styles.agente}>{children}</div>
    </div>
  );
}
