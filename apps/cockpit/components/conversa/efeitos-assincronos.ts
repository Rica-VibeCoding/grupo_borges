// Os dois efeitos da máquina cuja resposta volta depois e é conferida na volta: ligar o
// detector (o pedido do microfone) e frear o Zé (o POST do `■`). Saíram do `executaEfeito`
// de `use-modo-conversa.ts` (02/10), no molde de `transcricao-da-captura.ts`.
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { postAgentInterromper } from '@grupo_borges/cockpit-core/api';

import type { Evento } from '@/lib/conversa/tipos';

import type { FalaDevolvida } from './fala-devolvida';
import { reduzAviso } from './politicas-da-conversa';

type PortasDoDetector = {
  detector: { liga(): Promise<unknown> };
  captura: { bloqueadoRef: RefObject<boolean> };
  iniciandoRef: RefObject<boolean>;
  setAviso: Dispatch<SetStateAction<string | null>>;
  despachaRef: RefObject<(evento: Evento) => void>;
};

/** O efeito `ligarDetector`. */
export function ligaDetector({ detector, captura, iniciandoRef, setAviso, despachaRef }: PortasDoDetector) {
  void detector
    .liga()
    .then(() => {
      iniciandoRef.current = false;
      setAviso((atual) => reduzAviso(atual, { tipo: 'detectorLigou' }));
    })
    .catch((erro: unknown) => {
      iniciandoRef.current = false;
      if (captura.bloqueadoRef.current) return;
      const nome = erro instanceof DOMException ? erro.name : '';
      if (nome === 'AbortError') return;
      const negado = nome === 'NotAllowedError' || nome === 'SecurityError';
      despachaRef.current({ tipo: 'falhou', motivo: negado ? 'microfoneNegado' : 'capturaCaiu' });
    });
}

type PortasDoFreio = {
  slug: string;
  cicloRef: RefObject<number>;
  sessaoAtivaRef: RefObject<boolean>;
  devolvida: FalaDevolvida;
};

/** O efeito `frearZe`. */
export function freiaZe({ slug, cicloRef, sessaoAtivaRef, devolvida }: PortasDoFreio) {
  // O `■` do composer: antes da 1ª linha do Zé o servidor limpa o pedido devolvido à caixa, e a
  // fala limpa vai na frente da próxima. Falhar não é alarme: a resposta fica no chat de texto.
  const ciclo = cicloRef.current, guarda = devolvida.freio();
  void postAgentInterromper(slug).then((r) => void (ciclo === cicloRef.current && sessaoAtivaRef.current && guarda(r))).catch(() => {});
}
