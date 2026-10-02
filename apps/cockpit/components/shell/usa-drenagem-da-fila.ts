'use client';

/**
 * A fila andando: o efeito que despacha o próximo item quando a espera muda de
 * estado. Saiu de `composer.tsx` (02/10); quem enfileira e quem despacha
 * continua sendo o `enviar` de lá, que chega aqui a cada render.
 */
import { useEffect, useEffectEvent, type Dispatch, type SetStateAction } from 'react';
import type { EstadoCompact } from '../../lib/compact';
import type { FaseEnvio } from '../../lib/envio';
import type { OrigemEnvio } from '../../lib/usa-envio';
import {
  devolveAoInicio,
  proximoDaFila,
  reagiuAsFases,
  retira,
  type EstadoDaFila,
} from './fila-de-envio';

export function usaDrenagemDaFila({
  fila,
  setFila,
  estadoCompact,
  faseLocal,
  enviar,
}: {
  fila: EstadoDaFila;
  setFila: Dispatch<SetStateAction<EstadoDaFila>>;
  estadoCompact: EstadoCompact;
  faseLocal: FaseEnvio;
  enviar: (corpo: string, retomada?: boolean, origemRetomada?: OrigemEnvio) => Promise<boolean>;
}): void {
  /**
   * A FILA ANDANDO. Effect Event porque o despacho precisa LER a fila sem
   * DEPENDER dela como reação: o que dispara é a espera mudando de estado.
   *
   * A guarda de `ref` que se costuma escrever aqui não serviria — a doc do
   * React nomeia esse recurso como "a common pitfall" e diz com todas as letras
   * que ele "doesn't fix the bug", só esconde o duplo disparo do StrictMode em
   * desenvolvimento.
   *
   * `reagiuAsFases` devolve o MESMO objeto quando nada muda, então o `setFila`
   * de um tick sem novidade não re-renderiza e o efeito não gira em falso.
   */
  const drenarFila = useEffectEvent(() => {
    const fases = { compact: estadoCompact.fase, envio: faseLocal };
    const atualizado = reagiuAsFases(fila, fases);
    const proximo = proximoDaFila(atualizado, fases);
    if (!proximo) {
      setFila(atualizado);
      return;
    }
    setFila(retira(atualizado, proximo.id).estado);
    // `retomada: true`: o corpo não veio do campo. É o que impede a fila de
    // comer o que ele escreveu DEPOIS — e o que impede a foto retida de sair
    // de carona numa mensagem que não é dela.
    void enviar(proximo.texto, true, proximo.origem).then((saiu) => {
      if (!saiu) setFila((atual) => devolveAoInicio(atual, proximo));
    });
  });

  // A fila entra nas dependências de propósito, e não é ela que dispara o
  // despacho: é ela que faz a DRENAGEM CONTINUAR. Cada item que sai encolhe a
  // fila, o efeito roda de novo e o seguinte espera o eco do anterior — a
  // serialização sai da porta (`envio-em-voo`), não de um laço aqui. É também o
  // que faz o botão "enviar mesmo assim" despachar sem um caminho próprio: ele
  // só apaga a pausa.
  useEffect(() => {
    drenarFila();
  }, [estadoCompact.fase, faseLocal, fila]);
}
