'use client';

import { useState } from 'react';

import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';

import styles from './chave-de-visual.module.css';
import { CATALOGO, nomeDoVisual, type Visual } from './preferencia-visual';

/**
 * O único lugar em que o Rica escolhe o visual. Discreta de propósito: um ícone
 * no cabeçalho que abre uma folha. A troca vale na hora, atrás da folha.
 */
export function ChaveDeVisual({ visual, escolhe }: { visual: Visual; escolhe: (visual: Visual) => void }) {
  const [aberta, setAberta] = useState(false);
  return (
    <Drawer open={aberta} onOpenChange={setAberta}>
      <DrawerTrigger asChild>
        <button type="button" className={styles.gatilho} aria-label={`Visual da conversa: ${nomeDoVisual(visual)}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
            <rect x="3.5" y="2.5" width="17" height="19" rx="5" />
            <circle cx="12" cy="12" r="3.2" />
          </svg>
        </button>
      </DrawerTrigger>
      <DrawerContent className={styles.folha}>
        <DrawerHeader>
          <DrawerTitle>Visual da conversa</DrawerTitle>
          <DrawerDescription>Fica guardado neste aparelho.</DrawerDescription>
        </DrawerHeader>
        <div className={styles.grupos}>
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
                      onClick={() => escolhe({ opcao: item.opcao, variacao: v.id })}
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
