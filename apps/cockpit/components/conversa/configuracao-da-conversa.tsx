'use client';

import { useState, type ReactNode } from 'react';

import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';

import styles from './configuracao-da-conversa.module.css';
import { CATALOGO, type Visual } from './preferencia-visual';

type Props = {
  visual: Visual;
  escolheVisual: (visual: Visual) => void;
  fone: boolean;
  mudaFone: (ligado: boolean) => void;
  texto: boolean;
  mudaTexto: (ligado: boolean) => void;
};

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

/**
 * Tudo que se ajusta na conversa mora aqui, fora da tela: o fone, o texto e o
 * visual. Um ícone no cabeçalho abre a folha; cada troca vale na hora e fica
 * guardada no aparelho.
 */
export function ConfiguracaoDaConversa({ visual, escolheVisual, fone, mudaFone, texto, mudaTexto }: Props) {
  const [aberta, setAberta] = useState(false);
  return (
    <Drawer open={aberta} onOpenChange={setAberta}>
      <DrawerTrigger asChild>
        <button type="button" className={styles.gatilho} aria-label="Configurações da conversa">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M20 7h-9M14 17H5" />
            <circle cx="17" cy="17" r="3" />
            <circle cx="7" cy="7" r="3" />
          </svg>
        </button>
      </DrawerTrigger>
      <DrawerContent className={styles.folha}>
        <DrawerHeader>
          <DrawerTitle>Configurações</DrawerTitle>
          <DrawerDescription>Ficam guardadas neste aparelho.</DrawerDescription>
        </DrawerHeader>
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
          {CATALOGO.map((item) => (
            <section key={item.opcao} className={styles.grupo} aria-label={item.nome}>
              <h3 className={styles.nomeDoGrupo}>{item.nome}</h3>
              <div role="radiogroup" aria-label={item.nome} className={styles.variacoes}>
                {item.variacoes.map((v) => {
                  const marcada = visual.opcao === item.opcao && visual.variacao === v.id;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      role="radio"
                      aria-checked={marcada}
                      className={styles.variacao}
                      onClick={() => escolheVisual({ opcao: item.opcao, variacao: v.id })}
                    >
                      <span className={styles.nomeDaVariacao}>{v.nome}</span>
                      <span className={styles.descricao}>{v.descricao}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
