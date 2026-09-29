'use client';

import type { ReactNode } from 'react';

import styles from './configuracao-da-conversa.module.css';
import { DIRECOES, type Direcao } from './direcao-da-voz';
import { CATALOGO, type Visual } from './preferencia-visual';

export type ControlesDaConversaProps = {
  direcao: Direcao;
  escolheDirecao: (direcao: Direcao) => void;
  visual: Visual;
  escolheVisual: (visual: Visual) => void;
  fone: boolean;
  mudaFone: (ligado: boolean) => void;
  texto: boolean;
  mudaTexto: (ligado: boolean) => void;
  detalheTecnico: string | null;
};

function Opcoes<T extends string>({ nome, itens, marcado, escolhe }: {
  nome: string;
  itens: readonly { id: T; nome: string; descricao: string }[];
  marcado: (id: T) => boolean;
  escolhe: (id: T) => void;
}) {
  return (
    <section className={styles.grupo} aria-label={nome}>
      <h3 className={styles.nomeDoGrupo}>{nome}</h3>
      <div role="radiogroup" aria-label={nome} className={styles.variacoes}>
        {itens.map((v) => (
          <button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={marcado(v.id)}
            className={styles.variacao}
            onClick={() => escolhe(v.id)}
          >
            <span className={styles.nomeDaVariacao}>{v.nome}</span>
            <span className={styles.descricao}>{v.descricao}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Chave({ icone, nome, dica, ligada, muda }: {
  icone: ReactNode;
  nome: string;
  dica: string;
  ligada: boolean;
  muda: (ligada: boolean) => void;
}) {
  return (
    <div className={styles.linha}>
      <label className={styles.chave}>
        {icone}
        {nome}
        <input
          type="checkbox"
          role="switch"
          className={styles.interruptor}
          checked={ligada}
          onChange={(evento) => muda(evento.target.checked)}
        />
        <span className={styles.trilho} aria-hidden="true" />
      </label>
      <p className={styles.dica}>{dica}</p>
    </div>
  );
}

export function ControlesDaConversa({
  direcao, escolheDirecao, visual, escolheVisual, fone, mudaFone, texto, mudaTexto, detalheTecnico,
}: ControlesDaConversaProps) {
  return (
    <div className={styles.corpo}>
      <div className={styles.chaves}>
        <Chave
          icone={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 14v-2a9 9 0 0 1 18 0v2" />
              <path d="M21 16a2 2 0 0 1-2 2h-1a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3zM3 16a2 2 0 0 0 2 2h1a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1H3z" />
            </svg>
          }
          nome="Estou de fone"
          dica={fone ? 'Falar por cima interrompe a resposta.' : 'Espero a resposta terminar para ouvir.'}
          ligada={fone}
          muda={mudaFone}
        />
        <Chave
          icone={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h10" />
            </svg>
          }
          nome="Mostrar texto"
          dica={texto ? 'O estado, a sua fala e a resposta aparecem na tela.' : 'Na tela, só o visual e o botão.'}
          ligada={texto}
          muda={mudaTexto}
        />
      </div>
      <Opcoes nome="Foto do agente" itens={DIRECOES} marcado={(id) => id === direcao} escolhe={escolheDirecao} />
      {CATALOGO.map((item) => (
        <Opcoes
          key={item.opcao}
          nome={item.nome}
          itens={item.variacoes}
          marcado={(id) => visual.opcao === item.opcao && visual.variacao === id}
          escolhe={(id) => escolheVisual({ opcao: item.opcao, variacao: id })}
        />
      ))}
      {detalheTecnico ? <p className={styles.tecnico}>{detalheTecnico}</p> : null}
    </div>
  );
}
