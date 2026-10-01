'use client';

import { PilulaDoAgente as Pilula } from '../shell/pilula-do-agente';
import { usaEstadoDaPilula, usePublicaCenaDaVoz } from '../shell/usa-estado-da-pilula';

import type { Cena } from './moldura-estado';

/**
 * A pílula na tela de voz: a peça única (`shell/pilula-do-agente`) no alto, logo abaixo da ilha do
 * iPhone. Palavra e tom saem da mesma régua da gaveta (`shell/estado-da-pilula`), com a cena daqui
 * publicada para ela; a cena também liga o movimento — falando, o aro respira e solta ondas.
 */
export function PilulaDoAgente({ slug, nome, cena, segundos }: { slug: string; nome: string; cena: Cena; segundos?: number }) {
  usePublicaCenaDaVoz(slug, cena);
  const { tom, rotulo } = usaEstadoDaPilula(slug);
  return <Pilula slug={slug} nome={nome} tom={tom} rotulo={rotulo} cena={cena} segundos={segundos} />;
}
