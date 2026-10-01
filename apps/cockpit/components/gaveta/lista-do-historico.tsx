'use client';

/**
 * A lista do Histórico (rodada 2): filtros, busca e um bloco só com as linhas
 * de título e tempo — oito cabem sem rolar. Carregando, o mesmo bloco mostra
 * linhas-esqueleto da mesma altura e o conteúdo entra num fade; a linha que sai
 * some em opacity enquanto as de baixo sobem (`popLayout`).
 */
import { AnimatePresence } from 'motion/react';

import type { Conversa } from '@grupo_borges/cockpit-core/api';

import { listaVazia, type FiltroDeConversa } from './conversas';
import { ListaEsqueleto } from './esqueleto';
import { Busca, Filtros } from './filtros-de-conversa';
import { LinhaDeConversa } from './linha-de-conversa';
import { Bloco, Cartao } from './pecas';

export function ListaDoHistorico({
  linhas,
  carregando,
  agora,
  filtro,
  escolheFiltro,
  busca,
  mudaBusca,
  aoAbrir,
}: {
  linhas: Conversa[];
  carregando: boolean;
  agora: number;
  filtro: FiltroDeConversa;
  escolheFiltro: (f: FiltroDeConversa) => void;
  busca: string;
  mudaBusca: (v: string) => void;
  aoAbrir: (conversa: Conversa) => void;
}) {
  const ordem = linhas.map((c) => c.id).join(',');
  return (
    <>
      <Filtros filtro={filtro} escolhe={escolheFiltro} />
      <Busca valor={busca} muda={mudaBusca} />
      <Cartao rotulo="Conversas">
        <Bloco style={{ gap: 0, padding: 'var(--ck-space-1) 0' }}>
          {carregando ? (
            <ListaEsqueleto />
          ) : (
            <div className="relative flex flex-col">
              <AnimatePresence mode="popLayout">
                {linhas.map((c) => (
                  <LinhaDeConversa key={c.id} conversa={c} agora={agora} ordem={ordem} aoAbrir={() => aoAbrir(c)} />
                ))}
              </AnimatePresence>
              {linhas.length === 0 ? (
                <p role="status" style={{ padding: 'var(--ck-space-3) var(--ck-space-4)', fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}>
                  {listaVazia(filtro, busca)}
                </p>
              ) : null}
            </div>
          )}
        </Bloco>
      </Cartao>
    </>
  );
}
